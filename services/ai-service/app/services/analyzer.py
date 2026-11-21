"""Uçtan uca analiz orkestrasyonu.

Akış: görsel çözme -> nesne tespiti -> segmentasyon -> overlap -> skor
füzyonu/kalibrasyon -> karar. ONNX modelleri yüklü değilse (geliştirme/CI)
deterministik yedek hat kullanılır; bu durum yanıtta `backend: "heuristic"`
olarak açıkça bildirilir.
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone

from app.core.config import Settings
from app.schemas.analysis import (
    AnalyzeResponse,
    BoundingBox,
    DecisionOut,
    DetectionOut,
    ImageInfo,
    LatencyOut,
    MaskRle,
    MetricsOut,
    ModelVersion,
    ScoreOut,
    SegmentationOut,
    Thresholds,
)
from app.services.classes import rule_for
from app.services.detector import Detection, OnnxDetector
from app.services.heuristic import heuristic_detect, heuristic_segment
from app.services.imaging import decode_image, rle_encode
from app.services.onnx_models import ModelRegistry
from app.services.scoring import (
    compute_overlap,
    decide,
    fuse_score,
    temperature_scale,
)
from app.services.segmenter import OnnxSegmenter

#: İstenen request id üst sınırı (başlıktan gelen değerler için).
MAX_REQUEST_ID_LENGTH = 64


class Analyzer:
    """Tek bir görseli analiz eder; durum tutmaz (thread-safe)."""

    def __init__(self, registry: ModelRegistry, settings: Settings) -> None:
        self.registry = registry
        self.settings = settings

        self._detector = (
            OnnxDetector(registry.detector, settings, registry.class_names)
            if registry.detector
            else None
        )
        self._segmenter = (
            OnnxSegmenter(registry.segmenter, settings) if registry.segmenter else None
        )

    def analyze(
        self,
        data: bytes,
        *,
        declared_mime: str | None = None,
        include_mask: bool = False,
        request_id: str | None = None,
    ) -> AnalyzeResponse:
        total_start = time.perf_counter()

        preprocess_start = time.perf_counter()
        image = decode_image(
            data,
            max_bytes=self.settings.max_upload_bytes,
            max_dimension=self.settings.max_image_dimension,
            target_max_dimension=self.settings.analysis_max_dimension,
            declared_mime=declared_mime,
        )
        preprocess_ms = _elapsed_ms(preprocess_start)

        if self._detector is not None:
            detector_start = time.perf_counter()
            detections = self._detector.detect(image.rgb)
            detector_ms = _elapsed_ms(detector_start)
        else:
            detector_start = time.perf_counter()
            detections = heuristic_detect(image.rgb)
            detector_ms = _elapsed_ms(detector_start)

        if self._segmenter is not None:
            segmenter_start = time.perf_counter()
            segmentation = self._segmenter.segment(image.rgb)
            segmenter_ms = _elapsed_ms(segmenter_start)
        else:
            segmenter_start = time.perf_counter()
            segmentation = heuristic_segment(image.rgb)
            segmenter_ms = _elapsed_ms(segmenter_start)

        postprocess_start = time.perf_counter()

        detections = _stable_sort(detections)
        overlap = compute_overlap(detections, segmentation.walkable)

        rules = [rule_for(detection.label) for detection in detections]
        severities = [severity for _, severity in rules]

        raw_score = fuse_score(
            detections,
            overlap.overlap_ratio,
            overlap.obstruction_ratio,
            severities,
        )
        calibrated_score = temperature_scale(raw_score, self.settings.score_temperature)
        decision = decide(
            calibrated_score,
            auto_accept=self.settings.auto_accept_threshold,
            manual_review=self.settings.manual_review_threshold,
            detection_count=len(detections),
        )

        detection_outputs = [
            DetectionOut(
                label=detection.label,
                class_id=detection.class_id,
                confidence=round(detection.confidence, 4),
                box=BoundingBox(
                    x=round(detection.x1, 2),
                    y=round(detection.y1, 2),
                    width=round(detection.x2 - detection.x1, 2),
                    height=round(detection.y2 - detection.y1, 2),
                ),
                overlap_ratio=detection_overlap,
                severity=severity,
                violation_type=violation_type,
            )
            for detection, detection_overlap, (violation_type, severity) in zip(
                detections, overlap.per_detection, rules, strict=False
            )
        ]

        mask = None
        if include_mask:
            mask = MaskRle(
                size=(image.height, image.width),
                counts=rle_encode(segmentation.walkable),
            )

        postprocess_ms = _elapsed_ms(postprocess_start)
        total_ms = _elapsed_ms(total_start)

        return AnalyzeResponse(
            request_id=request_id or uuid.uuid4().hex,
            backend="onnx" if self._detector and self._segmenter else "heuristic",
            deterministic=True,
            models=self.model_versions(),
            image=ImageInfo(
                width=image.width,
                height=image.height,
                original_width=image.original_width,
                original_height=image.original_height,
                mime_type=image.mime_type,
                sha256=image.sha256,
                byte_size=image.byte_size,
            ),
            detections=detection_outputs,
            segmentation=SegmentationOut(
                walkable_area_ratio=round(segmentation.walkable_area_ratio, 4),
                sidewalk_ratio=round(segmentation.sidewalk_ratio, 4),
                crosswalk_ratio=round(segmentation.crosswalk_ratio, 4),
                obstacle_ratio=round(segmentation.obstacle_ratio, 4),
                mask=mask,
            ),
            metrics=MetricsOut(
                overlap_ratio=overlap.overlap_ratio,
                obstruction_ratio=overlap.obstruction_ratio,
                top_confidence=round(
                    max((detection.confidence for detection in detections), default=0.0), 4
                ),
                detection_count=len(detections),
            ),
            score=ScoreOut(
                raw=raw_score,
                calibrated=calibrated_score,
                temperature=self.settings.score_temperature,
            ),
            decision=DecisionOut(
                outcome=decision.outcome,  # type: ignore[arg-type]
                status=decision.status,  # type: ignore[arg-type]
                reason=decision.reason,
                thresholds=Thresholds(
                    auto_accept=self.settings.auto_accept_threshold,
                    manual_review=self.settings.manual_review_threshold,
                ),
            ),
            latency=LatencyOut(
                preprocess_ms=preprocess_ms,
                detector_ms=detector_ms,
                segmenter_ms=segmenter_ms,
                postprocess_ms=postprocess_ms,
                total_ms=total_ms,
            ),
            model_version=self.registry.model_version,
            analyzed_at=datetime.now(timezone.utc),
        )

    def model_versions(self) -> list[ModelVersion]:
        return [ModelVersion(**entry) for entry in self.registry.describe()]


def _stable_sort(detections: list[Detection]) -> list[Detection]:
    """Aynı görsel için her zaman aynı sırayı garanti eder."""
    return sorted(
        detections,
        key=lambda item: (
            -round(item.confidence, 6),
            round(item.y1, 2),
            round(item.x1, 2),
            item.label,
        ),
    )


def _elapsed_ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 2)


def normalize_request_id(value: str | None) -> str | None:
    if not value:
        return None

    cleaned = value.strip()
    if not cleaned or len(cleaned) > MAX_REQUEST_ID_LENGTH:
        return None

    if not all(character.isalnum() or character in "-_." for character in cleaned):
        return None

    return cleaned
