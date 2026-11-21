"""Nesne tespiti ve segmentasyon değerlendirme metrikleri.

Tespit:
  - Sınıf duyarlı greedy eşleştirme (IoU eşiği)
  - AP (all-point interpolation), mAP50, mAP50-95
  - En iyi F1 noktasında precision / recall

Segmentasyon:
  - Karmaşıklık matrisi, sınıf bazlı IoU, mIoU, piksel doğruluğu
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Sequence

import numpy as np

Box = tuple[float, float, float, float]

DEFAULT_IOU_THRESHOLDS: tuple[float, ...] = tuple(
    round(0.5 + 0.05 * index, 2) for index in range(10)
)


@dataclass(frozen=True)
class GroundTruth:
    image_id: str
    class_id: int
    box: Box


@dataclass(frozen=True)
class Prediction:
    image_id: str
    class_id: int
    box: Box
    score: float


@dataclass(frozen=True)
class ClassMetrics:
    class_id: int
    ap50: float
    ap50_95: float
    precision: float
    recall: float
    f1: float
    ground_truths: int
    predictions: int


@dataclass(frozen=True)
class DetectionMetrics:
    map50: float
    map50_95: float
    precision: float
    recall: float
    f1: float
    per_class: dict[int, ClassMetrics]
    num_ground_truths: int
    num_predictions: int
    iou_thresholds: tuple[float, ...] = DEFAULT_IOU_THRESHOLDS


@dataclass(frozen=True)
class SegmentationMetrics:
    mean_iou: float
    per_class_iou: dict[int, float]
    pixel_accuracy: float
    confusion: np.ndarray = field(repr=False)


def box_iou(first: Box, second: Box) -> float:
    """xyxy biçiminde iki kutunun IoU değeri."""
    x1 = max(first[0], second[0])
    y1 = max(first[1], second[1])
    x2 = min(first[2], second[2])
    y2 = min(first[3], second[3])

    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    first_area = max(0.0, first[2] - first[0]) * max(0.0, first[3] - first[1])
    second_area = max(0.0, second[2] - second[0]) * max(0.0, second[3] - second[1])
    union = first_area + second_area - intersection

    return intersection / union if union > 0 else 0.0


def evaluate_detections(
    ground_truths: Iterable[GroundTruth],
    predictions: Iterable[Prediction],
    *,
    iou_thresholds: Sequence[float] = DEFAULT_IOU_THRESHOLDS,
) -> DetectionMetrics:
    gts = list(ground_truths)
    preds = list(predictions)
    thresholds = tuple(float(value) for value in iou_thresholds)

    class_ids = sorted({gt.class_id for gt in gts} | {pred.class_id for pred in preds})
    per_class: dict[int, ClassMetrics] = {}

    for class_id in class_ids:
        class_gts = [gt for gt in gts if gt.class_id == class_id]
        class_preds = [pred for pred in preds if pred.class_id == class_id]

        average_precisions: list[float] = []
        for threshold in thresholds:
            matched = _match(class_preds, class_gts, threshold)
            average_precisions.append(_average_precision(matched, len(class_gts)))

        matched_at_50 = _match(class_preds, class_gts, thresholds[0])
        precision, recall, f1 = _best_f1(matched_at_50, len(class_gts))

        per_class[class_id] = ClassMetrics(
            class_id=class_id,
            ap50=average_precisions[0],
            ap50_95=float(np.mean(average_precisions)),
            precision=precision,
            recall=recall,
            f1=f1,
            ground_truths=len(class_gts),
            predictions=len(class_preds),
        )

    evaluated = [metrics for metrics in per_class.values() if metrics.ground_truths > 0]
    map50 = float(np.mean([metrics.ap50 for metrics in evaluated])) if evaluated else 0.0
    map50_95 = (
        float(np.mean([metrics.ap50_95 for metrics in evaluated])) if evaluated else 0.0
    )

    global_matches = _match(preds, gts, thresholds[0])
    precision, recall, f1 = _best_f1(global_matches, len(gts))

    return DetectionMetrics(
        map50=map50,
        map50_95=map50_95,
        precision=precision,
        recall=recall,
        f1=f1,
        per_class=per_class,
        num_ground_truths=len(gts),
        num_predictions=len(preds),
        iou_thresholds=thresholds,
    )


def _match(
    predictions: Sequence[Prediction],
    ground_truths: Sequence[GroundTruth],
    iou_threshold: float,
) -> list[bool]:
    """Tahminleri (skor azalan) GT'lerle eşleştirir; TP/FP bayrakları döner."""
    ordered = sorted(
        predictions,
        key=lambda prediction: (
            -prediction.score,
            prediction.image_id,
            prediction.box,
        ),
    )

    unmatched: dict[str, list[GroundTruth]] = {}
    for gt in ground_truths:
        unmatched.setdefault(gt.image_id, []).append(gt)

    matched_flags: list[bool] = []

    for prediction in ordered:
        candidates = unmatched.get(prediction.image_id, [])
        best_index = -1
        best_iou = iou_threshold

        for index, gt in enumerate(candidates):
            iou = box_iou(prediction.box, gt.box)
            if iou >= best_iou:
                best_iou = iou
                best_index = index

        if best_index >= 0:
            candidates.pop(best_index)
            matched_flags.append(True)
        else:
            matched_flags.append(False)

    return matched_flags


def _average_precision(matched: Sequence[bool], total_ground_truths: int) -> float:
    """All-point interpolated AP (COCO tarzı)."""
    if total_ground_truths == 0 or not matched:
        return 0.0

    flags = np.asarray(matched, dtype=bool)
    true_positives = np.cumsum(flags)
    false_positives = np.cumsum(~flags)

    recall = true_positives / total_ground_truths
    precision = true_positives / np.maximum(true_positives + false_positives, 1)

    mrecall = np.concatenate(([0.0], recall, [1.0]))
    mprecision = np.concatenate(([0.0], precision, [0.0]))

    for index in range(mprecision.size - 2, -1, -1):
        mprecision[index] = max(mprecision[index], mprecision[index + 1])

    indices = np.where(mrecall[1:] != mrecall[:-1])[0]
    return float(
        np.sum(
            (mrecall[indices + 1] - mrecall[indices]) * mprecision[indices + 1]
        )
    )


def _best_f1(matched: Sequence[bool], total_ground_truths: int) -> tuple[float, float, float]:
    if total_ground_truths == 0 or not matched:
        return 0.0, 0.0, 0.0

    flags = np.asarray(matched, dtype=bool)
    true_positives = np.cumsum(flags)
    false_positives = np.cumsum(~flags)

    precision = true_positives / np.maximum(true_positives + false_positives, 1)
    recall = true_positives / total_ground_truths
    denominator = precision + recall
    f1 = np.where(denominator > 0, 2 * precision * recall / denominator, 0.0)

    best = int(np.argmax(f1))
    return float(precision[best]), float(recall[best]), float(f1[best])


def confusion_matrix(
    predicted_masks: Sequence[np.ndarray],
    ground_truth_masks: Sequence[np.ndarray],
    num_classes: int,
) -> np.ndarray:
    if len(predicted_masks) != len(ground_truth_masks):
        raise ValueError("Tahmin ve GT maske sayıları eşit olmalı")
    if num_classes < 1:
        raise ValueError("num_classes en az 1 olmalı")

    matrix = np.zeros((num_classes, num_classes), dtype=np.int64)

    for predicted, truth in zip(predicted_masks, ground_truth_masks):
        predicted_array = np.asarray(predicted)
        truth_array = np.asarray(truth)

        if predicted_array.shape != truth_array.shape:
            raise ValueError("Maske boyutları eşleşmiyor")

        predicted_flat = predicted_array.reshape(-1).astype(np.int64)
        truth_flat = truth_array.reshape(-1).astype(np.int64)

        if predicted_flat.size and (
            predicted_flat.min() < 0
            or predicted_flat.max() >= num_classes
            or truth_flat.min() < 0
            or truth_flat.max() >= num_classes
        ):
            raise ValueError("Maske sınıf indeksi aralık dışında")

        indices = truth_flat * num_classes + predicted_flat
        matrix += np.bincount(indices, minlength=num_classes**2).reshape(
            num_classes, num_classes
        )

    return matrix


def evaluate_segmentation(
    predicted_masks: Sequence[np.ndarray],
    ground_truth_masks: Sequence[np.ndarray],
    num_classes: int,
    *,
    include_background: bool = False,
) -> SegmentationMetrics:
    matrix = confusion_matrix(predicted_masks, ground_truth_masks, num_classes)

    intersection = np.diag(matrix).astype(np.float64)
    ground_truth_area = matrix.sum(axis=1)
    predicted_area = matrix.sum(axis=0)
    union = ground_truth_area + predicted_area - intersection

    per_class_iou: dict[int, float] = {}
    for class_id in range(num_classes):
        per_class_iou[class_id] = (
            float(intersection[class_id] / union[class_id])
            if union[class_id] > 0
            else 0.0
        )

    selected = range(num_classes) if include_background else range(1, num_classes)
    selected_iou = [
        per_class_iou[index] for index in selected if union[index] > 0
    ]
    mean_iou = float(np.mean(selected_iou)) if selected_iou else 0.0

    total = matrix.sum()
    accuracy = float(intersection.sum() / total) if total > 0 else 0.0

    return SegmentationMetrics(
        mean_iou=mean_iou,
        per_class_iou=per_class_iou,
        pixel_accuracy=accuracy,
        confusion=matrix,
    )
