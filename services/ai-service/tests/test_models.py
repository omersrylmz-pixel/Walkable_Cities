"""YOLO / DETR / segmentasyon adaptörlerinin sözleşme testleri.

Gerçek ONNX ağırlığı olmadan, `LoadedModel` yerine sahte bir çalıştırıcı
kullanılarak ön/son işleme ve NMS davranışı doğrulanır.
"""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

from app.core.config import Settings
from app.services.detector import OnnxDetector
from app.services.segmenter import OnnxSegmenter


class _FakeSession:
    def __init__(self, output_names: tuple[str, ...]) -> None:
        self._outputs = [SimpleNamespace(name=name) for name in output_names]

    def get_outputs(self) -> list[SimpleNamespace]:
        return self._outputs


class _FakeModel:
    def __init__(self, outputs: list[np.ndarray], output_names: tuple[str, ...]) -> None:
        self._outputs = outputs
        self.session = _FakeSession(output_names)
        self.last_input: np.ndarray | None = None

    def run(self, tensor: np.ndarray) -> list[np.ndarray]:
        self.last_input = tensor
        return self._outputs


def _settings(**overrides) -> Settings:
    values = {
        "model_dir": "./does-not-exist",
        "warmup_on_startup": False,
        "detector_input_size": 640,
        "segmenter_input_size": 512,
        "detector_confidence_threshold": 0.25,
        "detector_iou_threshold": 0.45,
        "max_detections": 50,
    }
    values.update(overrides)
    return Settings(**values)


def _rgb(width: int = 320, height: int = 240) -> np.ndarray:
    return np.full((height, width, 3), 128, dtype=np.uint8)


def test_yolo_adapter_maps_boxes_back_from_letterbox_and_applies_nms() -> None:
    raw = np.zeros((1, 6, 3), dtype=np.float32)

    # Sınıf 0: kaynak merkez (160, 120), 100x80 kutu -> letterbox (320, 320, 200, 160)
    raw[0, :4, 0] = [320, 320, 200, 160]
    raw[0, 4, 0] = 0.90
    # Aynı kutunun kaydırılmış kopyası -> NMS ile bastırılmalı
    raw[0, :4, 1] = [325, 322, 200, 160]
    raw[0, 4, 1] = 0.80
    # Sınıf 1: daha küçük, IoU eşiğinin altında kalan kutu
    raw[0, :4, 2] = [320, 320, 100, 80]
    raw[0, 4, 2] = 0.10
    raw[0, 5, 2] = 0.70

    model = _FakeModel([raw], ("output0",))
    detector = OnnxDetector(model, _settings(), ["car", "bench"])

    detections = detector.detect(_rgb())

    assert model.last_input is not None
    assert model.last_input.shape == (1, 3, 640, 640)
    assert model.last_input.dtype == np.float32
    assert 0.0 <= float(model.last_input.min()) <= 1.0

    assert len(detections) == 2
    car, bench = detections

    assert car.label == "car"
    assert car.class_id == 0
    assert car.confidence == pytest.approx(0.9, abs=1e-6)
    assert car.x1 == pytest.approx(110.0)
    assert car.y1 == pytest.approx(80.0)
    assert car.x2 == pytest.approx(210.0)
    assert car.y2 == pytest.approx(160.0)

    assert bench.label == "bench"
    assert bench.class_id == 1
    assert bench.confidence == pytest.approx(0.7, abs=1e-6)


def test_yolo_adapter_accepts_transposed_output() -> None:
    raw = np.zeros((1, 3, 6), dtype=np.float32)
    raw[0, 0, :4] = [320, 320, 200, 160]
    raw[0, 0, 4] = 0.88
    raw[0, 1, :4] = [100, 100, 40, 20]
    raw[0, 1, 5] = 0.66

    detector = OnnxDetector(
        _FakeModel([raw], ("output0",)),
        _settings(),
        ["car", "bench"],
    )

    detections = detector.detect(_rgb())

    assert len(detections) == 2
    assert {detection.label for detection in detections} == {"car", "bench"}


def test_detr_adapter_reads_named_outputs_and_normalized_boxes() -> None:
    boxes = np.array([[[0.5, 0.5, 0.25, 0.25], [0.2, 0.2, 0.1, 0.1]]], dtype=np.float32)
    scores = np.array([[0.9, 0.3]], dtype=np.float32)
    labels = np.array([[0, 1]], dtype=np.int64)

    detector = OnnxDetector(
        _FakeModel([boxes, scores, labels], ("boxes", "scores", "labels")),
        _settings(detector_output_format="detr"),
        ["car", "bench"],
    )

    detections = detector.detect(_rgb())

    assert len(detections) == 2
    car, bench = detections

    assert car.label == "car"
    assert car.x1 == pytest.approx(120.0)
    assert car.y1 == pytest.approx(90.0)
    assert car.x2 == pytest.approx(200.0)
    assert car.y2 == pytest.approx(150.0)
    assert bench.label == "bench"


def test_segmenter_converts_logits_to_walkable_ratios_and_mask() -> None:
    logits = np.zeros((1, 5, 2, 2), dtype=np.float32)
    logits[0, 1, 0, 0] = 10.0  # sidewalk
    logits[0, 2, 0, 1] = 10.0  # crosswalk
    logits[0, 0, 1, 0] = 10.0  # background
    logits[0, 4, 1, 1] = 10.0  # obstacle

    segmenter = OnnxSegmenter(
        _FakeModel([logits], ("logits",)),
        _settings(segmenter_input_size=512),
    )

    result = segmenter.segment(_rgb())

    assert result.walkable.shape == (240, 320)
    assert result.sidewalk_ratio == pytest.approx(0.25)
    assert result.crosswalk_ratio == pytest.approx(0.25)
    assert result.obstacle_ratio == pytest.approx(0.25)
    assert result.walkable_area_ratio == pytest.approx(0.5)
    assert bool(result.walkable[10, 10]) is True
    assert bool(result.walkable[10, 300]) is True
    assert bool(result.walkable[230, 10]) is False
    assert bool(result.walkable[230, 300]) is False


def test_segmenter_accepts_class_index_output() -> None:
    class_map = np.array([[[1, 2], [0, 1]]], dtype=np.int32)

    segmenter = OnnxSegmenter(
        _FakeModel([class_map], ("classes",)),
        _settings(segmenter_input_size=512),
    )

    result = segmenter.segment(_rgb(width=32, height=32))

    assert result.walkable.shape == (32, 32)
    assert result.sidewalk_ratio == pytest.approx(0.5)
    assert result.crosswalk_ratio == pytest.approx(0.25)
    assert result.walkable_area_ratio == pytest.approx(0.75)
