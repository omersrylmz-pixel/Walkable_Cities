"""Tespit ve segmentasyon metrikleri testleri."""

from __future__ import annotations

import numpy as np
import pytest

from src.evaluation.metrics import (
    GroundTruth,
    Prediction,
    _match,
    box_iou,
    evaluate_detections,
    evaluate_segmentation,
)


def test_box_iou_cases() -> None:
    assert box_iou((0, 0, 10, 10), (0, 0, 10, 10)) == 1.0
    assert box_iou((0, 0, 10, 10), (20, 20, 30, 30)) == 0.0
    assert box_iou((0, 0, 10, 10), (0, 0, 5, 10)) == pytest.approx(0.5)


def test_perfect_predictions_score_one() -> None:
    ground_truths = [
        GroundTruth("img1", 0, (0, 0, 10, 10)),
        GroundTruth("img1", 1, (20, 20, 30, 30)),
        GroundTruth("img2", 0, (0, 0, 5, 5)),
    ]
    predictions = [
        Prediction("img1", 0, (0, 0, 10, 10), 0.9),
        Prediction("img1", 1, (20, 20, 30, 30), 0.8),
        Prediction("img2", 0, (0, 0, 5, 5), 0.7),
    ]

    metrics = evaluate_detections(ground_truths, predictions)

    assert metrics.map50 == pytest.approx(1.0)
    assert metrics.map50_95 == pytest.approx(1.0)
    assert metrics.precision == pytest.approx(1.0)
    assert metrics.recall == pytest.approx(1.0)
    assert metrics.f1 == pytest.approx(1.0)
    assert metrics.per_class[0].ground_truths == 2
    assert metrics.per_class[0].ap50 == pytest.approx(1.0)
    assert metrics.num_ground_truths == 3


def test_false_positive_reduces_map() -> None:
    ground_truths = [
        GroundTruth("img1", 0, (0, 0, 10, 10)),
        GroundTruth("img1", 0, (20, 20, 30, 30)),
    ]
    predictions = [
        Prediction("img1", 0, (0, 0, 10, 10), 0.9),
        Prediction("img1", 0, (50, 50, 60, 60), 0.85),
        Prediction("img1", 0, (20, 20, 30, 30), 0.7),
    ]

    metrics = evaluate_detections(ground_truths, predictions)

    assert 0.5 < metrics.map50 < 1.0
    assert metrics.f1 < 1.0
    assert metrics.per_class[0].predictions == 3


def test_missed_ground_truth_reduces_recall() -> None:
    ground_truths = [
        GroundTruth("img1", 0, (0, 0, 10, 10)),
        GroundTruth("img1", 0, (20, 20, 30, 30)),
        GroundTruth("img1", 1, (0, 0, 5, 5)),
    ]
    predictions = [
        Prediction("img1", 0, (0, 0, 10, 10), 0.9),
        Prediction("img1", 1, (0, 0, 5, 5), 0.9),
    ]

    metrics = evaluate_detections(ground_truths, predictions)

    assert metrics.per_class[0].recall == pytest.approx(0.5)
    assert metrics.per_class[0].ap50 == pytest.approx(0.5)
    assert metrics.map50 == pytest.approx(0.75)


def test_duplicate_prediction_is_counted_as_false_positive() -> None:
    ground_truth = [GroundTruth("img1", 0, (0, 0, 10, 10))]
    predictions = [
        Prediction("img1", 0, (0, 0, 10, 10), 0.9),
        Prediction("img1", 0, (0, 0, 10, 10), 0.8),
    ]

    matched = _match(predictions, ground_truth, 0.5)

    assert matched == [True, False]


def test_class_confusion_is_not_a_match() -> None:
    ground_truths = [GroundTruth("img1", 0, (0, 0, 10, 10))]
    predictions = [Prediction("img1", 1, (0, 0, 10, 10), 0.99)]

    metrics = evaluate_detections(ground_truths, predictions)

    assert metrics.per_class[0].ap50 == 0.0
    assert metrics.per_class[1].ground_truths == 0
    assert metrics.map50 == 0.0


def test_segmentation_perfect_masks() -> None:
    truth = np.array([[0, 0], [1, 1]])
    predicted = truth.copy()

    metrics = evaluate_segmentation([predicted], [truth], num_classes=3)

    assert metrics.mean_iou == pytest.approx(1.0)
    assert metrics.pixel_accuracy == pytest.approx(1.0)
    assert metrics.per_class_iou == {0: 1.0, 1: 1.0, 2: 0.0}


def test_segmentation_partial_overlap() -> None:
    truth = np.array([[0, 0], [1, 1]])
    predicted = np.array([[0, 1], [1, 1]])

    metrics = evaluate_segmentation([predicted], [truth], num_classes=2)

    assert metrics.per_class_iou[0] == pytest.approx(0.5)
    assert metrics.per_class_iou[1] == pytest.approx(2 / 3)
    assert metrics.mean_iou == pytest.approx(2 / 3)
    assert metrics.pixel_accuracy == pytest.approx(0.75)
    np.testing.assert_array_equal(metrics.confusion, np.array([[1, 1], [0, 2]]))


def test_segmentation_include_background_changes_mean() -> None:
    truth = np.array([[0, 0], [1, 1]])
    predicted = np.array([[0, 1], [1, 1]])

    metrics = evaluate_segmentation(
        [predicted], [truth], num_classes=2, include_background=True
    )

    assert metrics.mean_iou == pytest.approx((0.5 + 2 / 3) / 2)


def test_segmentation_rejects_out_of_range_classes() -> None:
    with pytest.raises(ValueError):
        evaluate_segmentation(
            [np.array([[0, 5]])],
            [np.array([[0, 1]])],
            num_classes=2,
        )
