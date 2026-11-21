"""Overlap, skor füzyonu, kalibrasyon ve karar bandı testleri."""

from __future__ import annotations

import numpy as np
import pytest

from app.services.detector import Detection
from app.services.scoring import (
    compute_overlap,
    decide,
    fuse_score,
    temperature_scale,
)


def _detection(x1: float, y1: float, x2: float, y2: float, confidence: float = 0.8) -> Detection:
    return Detection(
        label="vehicle_on_walkway",
        class_id=0,
        confidence=confidence,
        x1=x1,
        y1=y1,
        x2=x2,
        y2=y2,
    )


def test_overlap_is_exact_for_half_covered_box() -> None:
    walkable = np.zeros((100, 100), dtype=bool)
    walkable[50:, :] = True

    metrics = compute_overlap([_detection(0, 0, 100, 100)], walkable)

    assert metrics.overlap_ratio == pytest.approx(0.5)
    assert metrics.obstruction_ratio == pytest.approx(1.0)
    assert metrics.per_detection == [0.5]


def test_overlap_ignores_boxes_outside_walkable_area() -> None:
    walkable = np.zeros((100, 100), dtype=bool)
    walkable[50:, :] = True

    metrics = compute_overlap([_detection(10, 10, 40, 40)], walkable)

    assert metrics.overlap_ratio == 0.0
    assert metrics.obstruction_ratio == 0.0


def test_overlap_returns_zero_without_detections() -> None:
    walkable = np.ones((10, 10), dtype=bool)

    metrics = compute_overlap([], walkable)

    assert metrics.overlap_ratio == 0.0
    assert metrics.obstruction_ratio == 0.0
    assert metrics.per_detection == []


def test_overlap_averages_by_box_area() -> None:
    walkable = np.zeros((100, 100), dtype=bool)
    walkable[50:, :] = True

    # Büyük kutu tamamen yürünebilir (100x50), küçük kutu tamamen dışarıda (10x10).
    metrics = compute_overlap(
        [_detection(0, 50, 100, 100), _detection(0, 0, 10, 10)],
        walkable,
    )

    expected = 5000 / 5100
    assert metrics.overlap_ratio == pytest.approx(expected, abs=1e-4)


def test_fused_score_uses_all_factors_and_clips() -> None:
    detections = [_detection(0, 0, 10, 10, confidence=1.0)]

    score = fuse_score(
        detections,
        overlap_ratio=1.0,
        obstruction_ratio=1.0,
        severities=[5],
    )

    assert score == pytest.approx(1.0)


def test_fused_score_is_zero_without_detections() -> None:
    assert fuse_score([], overlap_ratio=1.0, obstruction_ratio=1.0) == 0.0


def test_temperature_one_is_identity() -> None:
    for score in (0.05, 0.25, 0.5, 0.75, 0.95):
        assert temperature_scale(score, 1.0) == pytest.approx(score, abs=1e-4)


def test_temperature_above_one_softens_towards_half() -> None:
    softened = temperature_scale(0.9, 2.0)

    assert 0.5 < softened < 0.9


def test_temperature_below_one_sharpens() -> None:
    sharpened = temperature_scale(0.7, 0.5)

    assert sharpened > 0.7


def test_temperature_must_be_positive() -> None:
    with pytest.raises(ValueError):
        temperature_scale(0.5, 0.0)


@pytest.mark.parametrize(
    ("score", "expected"),
    [
        (0.95, "auto_accept"),
        (0.85, "auto_accept"),
        (0.8499, "manual_review"),
        (0.60, "manual_review"),
        (0.5999, "auto_reject"),
        (0.0, "auto_reject"),
    ],
)
def test_decision_bands(score: float, expected: str) -> None:
    decision = decide(
        score,
        auto_accept=0.85,
        manual_review=0.60,
        detection_count=1,
    )

    assert decision.outcome == expected


def test_decision_rejects_when_nothing_detected() -> None:
    decision = decide(
        0.99,
        auto_accept=0.85,
        manual_review=0.60,
        detection_count=0,
    )

    assert decision.outcome == "auto_reject"
    assert decision.status == "auto_rejected"
