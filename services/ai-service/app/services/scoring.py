"""Overlap, skor füzyonu ve karar eşikleri."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from app.services.detector import Detection

#: Skor füzyon ağırlıkları (toplam 1.0).
WEIGHT_CONFIDENCE = 0.45
WEIGHT_PLACEMENT = 0.30
WEIGHT_COVERAGE = 0.15
WEIGHT_SEVERITY = 0.10

#: Yürünebilir alanın bu oranı engellenmişse coverage tam sayılır.
COVERAGE_SATURATION = 0.50

EPSILON = 1e-6


@dataclass(frozen=True)
class OverlapMetrics:
    overlap_ratio: float
    obstruction_ratio: float
    per_detection: list[float]


@dataclass(frozen=True)
class Decision:
    outcome: str
    status: str
    reason: str


def compute_overlap(
    detections: list[Detection],
    walkable: np.ndarray,
) -> OverlapMetrics:
    """Kutuların yürünebilir alanla örtüşme oranlarını hesaplar.

    - `overlap_ratio`: tüm kutu alanlarının ağırlıklı ortalaması.
    - `obstruction_ratio`: kutu birleşiminin yürünebilir alanla kesişiminin
      yürünebilir alana oranı (yürünebilir alanın ne kadarı kapalı).
    """
    height, width = walkable.shape[:2]
    walkable_area = float(walkable.sum())

    if not detections or walkable_area <= 0:
        return OverlapMetrics(overlap_ratio=0.0, obstruction_ratio=0.0, per_detection=[0.0] * len(detections))

    union_mask = np.zeros((height, width), dtype=bool)
    per_detection: list[float] = []
    total_box_area = 0.0
    total_intersection = 0.0

    for detection in detections:
        x1 = max(0, min(width, int(math.floor(detection.x1))))
        y1 = max(0, min(height, int(math.floor(detection.y1))))
        x2 = max(0, min(width, int(math.ceil(detection.x2))))
        y2 = max(0, min(height, int(math.ceil(detection.y2))))

        if x2 <= x1 or y2 <= y1:
            per_detection.append(0.0)
            continue

        box_mask = np.zeros((height, width), dtype=bool)
        box_mask[y1:y2, x1:x2] = True
        union_mask |= box_mask

        box_area = float(box_mask.sum())
        intersection = float((box_mask & walkable).sum())
        ratio = intersection / box_area if box_area > 0 else 0.0

        per_detection.append(round(ratio, 4))
        total_box_area += box_area
        total_intersection += intersection

    overlap_ratio = total_intersection / total_box_area if total_box_area > 0 else 0.0
    obstruction_ratio = (
        min(1.0, float((union_mask & walkable).sum()) / walkable_area)
        if walkable_area > 0
        else 0.0
    )

    return OverlapMetrics(
        overlap_ratio=round(overlap_ratio, 4),
        obstruction_ratio=round(obstruction_ratio, 4),
        per_detection=per_detection,
    )


def fuse_score(
    detections: list[Detection],
    overlap_ratio: float,
    obstruction_ratio: float,
    severities: list[int] | None = None,
) -> float:
    """Tespit güveni, konum, kapsama ve ağırlıktan 0–1 skor üretir."""
    if not detections:
        return 0.0

    top_confidence = max(detection.confidence for detection in detections)
    severity_values = severities or [3] * len(detections)
    max_severity = max(severity_values) if severity_values else 3
    severity_factor = min(1.0, max_severity / 5.0)
    coverage_factor = min(1.0, obstruction_ratio / COVERAGE_SATURATION)

    score = (
        WEIGHT_CONFIDENCE * top_confidence
        + WEIGHT_PLACEMENT * overlap_ratio
        + WEIGHT_COVERAGE * coverage_factor
        + WEIGHT_SEVERITY * severity_factor
    )

    return round(float(np.clip(score, 0.0, 1.0)), 4)


def temperature_scale(score: float, temperature: float) -> float:
    """Temperature scaling: sigmoid(logit(p) / T).

    T = 1.0 girdiyi değiştirmez; T > 1 skoru 0.5'e doğru yumuşatır.
    """
    if temperature <= 0:
        raise ValueError("temperature pozitif olmalı")

    clipped = min(1 - EPSILON, max(EPSILON, score))
    logit = math.log(clipped / (1 - clipped))
    calibrated = 1 / (1 + math.exp(-logit / temperature))

    return round(float(calibrated), 4)


def decide(
    score: float,
    *,
    auto_accept: float,
    manual_review: float,
    detection_count: int,
) -> Decision:
    if detection_count == 0:
        return Decision(
            outcome="auto_reject",
            status="auto_rejected",
            reason="Görselde engel tespit edilmedi",
        )

    if score >= auto_accept:
        return Decision(
            outcome="auto_accept",
            status="auto_approved",
            reason=f"Skor {score:.2f} >= otomatik kabul eşiği {auto_accept:.2f}",
        )

    if score >= manual_review:
        return Decision(
            outcome="manual_review",
            status="pending_review",
            reason=f"Skor {score:.2f} manuel inceleme bandında ({manual_review:.2f}–{auto_accept:.2f})",
        )

    return Decision(
        outcome="auto_reject",
        status="auto_rejected",
        reason=f"Skor {score:.2f} < manuel inceleme eşiği {manual_review:.2f}",
    )
