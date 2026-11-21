"""ONNX nesne tespiti adaptörü (YOLO ve DETR çıktı biçimleri)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.core.config import Settings
from app.services.imaging import letterbox, resize_rgb, to_nchw
from app.services.onnx_models import LoadedModel


@dataclass(frozen=True)
class Detection:
    label: str
    class_id: int
    confidence: float
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def xyxy(self) -> tuple[float, float, float, float]:
        return self.x1, self.y1, self.x2, self.y2

    @property
    def area(self) -> float:
        return max(0.0, self.x2 - self.x1) * max(0.0, self.y2 - self.y1)


class OnnxDetector:
    def __init__(self, model: LoadedModel, settings: Settings, class_names: list[str]) -> None:
        self.model = model
        self.settings = settings
        self.class_names = class_names

    def detect(self, rgb: np.ndarray) -> list[Detection]:
        height, width = rgb.shape[:2]

        if self.settings.detector_output_format == "detr":
            return self._detect_detr(rgb, width, height)

        return self._detect_yolo(rgb, width, height)

    # ------------------------------------------------------------------ YOLO
    def _detect_yolo(self, rgb: np.ndarray, width: int, height: int) -> list[Detection]:
        size = self.settings.detector_input_size
        padded, scale, pad_x, pad_y = letterbox(rgb, size)
        tensor = to_nchw(padded)

        outputs = self.model.run(tensor)
        if not outputs:
            return []

        raw = np.asarray(outputs[0])
        if raw.ndim == 3:
            raw = raw[0]

        if raw.ndim != 2:
            raise ValueError(f"Beklenmeyen YOLO çıktı boyutu: {raw.shape}")

        # [4+C, N] -> [N, 4+C]
        if raw.shape[0] < raw.shape[1] and raw.shape[0] <= 4 + 512:
            raw = raw.T

        if raw.shape[1] < 5:
            return []

        boxes_cxcywh = raw[:, :4]
        class_scores = raw[:, 4:]
        class_ids = np.argmax(class_scores, axis=1)
        scores = class_scores[np.arange(class_scores.shape[0]), class_ids]

        keep = scores >= self.settings.detector_confidence_threshold
        boxes_cxcywh = boxes_cxcywh[keep]
        class_ids = class_ids[keep]
        scores = scores[keep]

        if boxes_cxcywh.shape[0] == 0:
            return []

        # cx, cy, w, h -> x1, y1, x2, y2 (letterbox piksel uzayı)
        cx, cy, bw, bh = boxes_cxcywh.T
        x1 = cx - bw / 2
        y1 = cy - bh / 2
        x2 = cx + bw / 2
        y2 = cy + bh / 2
        boxes = np.stack([x1, y1, x2, y2], axis=1)

        # Harf kutusu dolgusunu ve ölçeği geri al.
        boxes[:, [0, 2]] = (boxes[:, [0, 2]] - pad_x) / scale
        boxes[:, [1, 3]] = (boxes[:, [1, 3]] - pad_y) / scale

        boxes, scores, class_ids = _nms(
            boxes,
            scores,
            class_ids,
            self.settings.detector_iou_threshold,
            self.settings.max_detections,
        )

        return self._build_detections(boxes, scores, class_ids, width, height)

    # ------------------------------------------------------------------ DETR
    def _detect_detr(self, rgb: np.ndarray, width: int, height: int) -> list[Detection]:
        size = self.settings.detector_input_size
        square = resize_rgb(rgb, size, size)
        outputs = self.model.run(to_nchw(square))

        output_names = [output.name.lower() for output in self.model.session.get_outputs()]
        by_name = {
            name: np.asarray(value)
            for name, value in zip(output_names, outputs, strict=False)
        }

        boxes_arr = _find_output(by_name, ("boxes", "pred_boxes", "bbox"))
        scores_arr = _find_output(by_name, ("scores", "logits"))
        labels_arr = _find_output(by_name, ("labels", "classes", "class"))

        if boxes_arr is None:
            return []

        boxes = np.squeeze(boxes_arr, axis=0) if boxes_arr.ndim == 3 else boxes_arr
        if boxes.ndim != 2 or boxes.shape[1] < 4:
            return []

        if scores_arr is None:
            scores = np.ones(boxes.shape[0], dtype=np.float32)
        else:
            scores = np.squeeze(scores_arr)
            if scores.ndim == 2:
                scores = np.max(scores, axis=1)
            scores = scores.reshape(-1)

        if labels_arr is None:
            class_ids = np.zeros(boxes.shape[0], dtype=np.int64)
        else:
            labels = np.squeeze(labels_arr)
            if labels.ndim == 2:
                labels = np.argmax(labels, axis=1)
            class_ids = labels.reshape(-1).astype(np.int64)

        count = min(boxes.shape[0], scores.shape[0], class_ids.shape[0])
        boxes = boxes[:count, :4].astype(np.float32)
        scores = scores[:count].astype(np.float32)
        class_ids = class_ids[:count]

        # DETR standart çıktısı: normalize cx,cy,w,h.
        normalized = float(np.max(boxes)) <= 1.5
        if normalized:
            cx, cy, bw, bh = boxes.T
            boxes = np.stack([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], axis=1)
            boxes[:, [0, 2]] *= width
            boxes[:, [1, 3]] *= height

        keep = scores >= self.settings.detector_confidence_threshold
        boxes, scores, class_ids = boxes[keep], scores[keep], class_ids[keep]

        boxes, scores, class_ids = _nms(
            boxes,
            scores,
            class_ids,
            self.settings.detector_iou_threshold,
            self.settings.max_detections,
        )

        return self._build_detections(boxes, scores, class_ids, width, height)

    # --------------------------------------------------------------- ortak
    def _build_detections(
        self,
        boxes: np.ndarray,
        scores: np.ndarray,
        class_ids: np.ndarray,
        width: int,
        height: int,
    ) -> list[Detection]:
        detections: list[Detection] = []

        for (x1, y1, x2, y2), score, class_id in zip(boxes, scores, class_ids, strict=False):
            label = (
                self.class_names[int(class_id)]
                if 0 <= int(class_id) < len(self.class_names)
                else f"class_{int(class_id)}"
            )

            clipped_x1 = float(np.clip(x1, 0, width))
            clipped_y1 = float(np.clip(y1, 0, height))
            clipped_x2 = float(np.clip(x2, 0, width))
            clipped_y2 = float(np.clip(y2, 0, height))

            if clipped_x2 - clipped_x1 < 1 or clipped_y2 - clipped_y1 < 1:
                continue

            detections.append(
                Detection(
                    label=label,
                    class_id=int(class_id),
                    confidence=float(np.clip(score, 0, 1)),
                    x1=clipped_x1,
                    y1=clipped_y1,
                    x2=clipped_x2,
                    y2=clipped_y2,
                )
            )

        return detections


def _find_output(outputs: dict[str, np.ndarray], keywords: tuple[str, ...]) -> np.ndarray | None:
    for name, value in outputs.items():
        if any(keyword in name for keyword in keywords):
            return value
    return None


def _nms(
    boxes: np.ndarray,
    scores: np.ndarray,
    class_ids: np.ndarray,
    iou_threshold: float,
    max_detections: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Sınıf duyarsız greedy NMS."""
    if boxes.shape[0] == 0:
        return boxes, scores, class_ids

    x1, y1, x2, y2 = boxes.T
    areas = np.maximum(0, x2 - x1) * np.maximum(0, y2 - y1)
    order = scores.argsort()[::-1]

    keep: list[int] = []

    while order.size > 0 and len(keep) < max_detections:
        current = int(order[0])
        keep.append(current)

        if order.size == 1:
            break

        rest = order[1:]
        xx1 = np.maximum(x1[current], x1[rest])
        yy1 = np.maximum(y1[current], y1[rest])
        xx2 = np.minimum(x2[current], x2[rest])
        yy2 = np.minimum(y2[current], y2[rest])

        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        union = areas[current] + areas[rest] - inter
        iou = np.where(union > 0, inter / union, 0)

        order = rest[iou <= iou_threshold]

    indices = np.asarray(keep, dtype=np.int64)
    return boxes[indices], scores[indices], class_ids[indices]
