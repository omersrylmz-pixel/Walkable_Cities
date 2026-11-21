"""ONNX segmentasyon adaptörü (kaldırım / yaya geçidi maskesi)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.core.config import Settings
from app.services.imaging import resize_mask_nearest, resize_rgb, to_nchw
from app.services.onnx_models import LoadedModel

SIDEWALK_CLASS = 1
CROSSWALK_CLASS = 2
OBSTACLE_CLASS = 4


@dataclass(frozen=True)
class Segmentation:
    walkable: np.ndarray
    sidewalk_ratio: float
    crosswalk_ratio: float
    obstacle_ratio: float

    @property
    def walkable_area_ratio(self) -> float:
        return float(self.walkable.mean()) if self.walkable.size else 0.0


class OnnxSegmenter:
    def __init__(self, model: LoadedModel, settings: Settings) -> None:
        self.model = model
        self.settings = settings

    def segment(self, rgb: np.ndarray) -> Segmentation:
        height, width = rgb.shape[:2]
        size = self.settings.segmenter_input_size

        square = resize_rgb(rgb, size, size)
        class_map = self._class_map(self.model.run(to_nchw(square))[0])

        sidewalk = resize_mask_nearest(class_map == SIDEWALK_CLASS, height, width)
        crosswalk = resize_mask_nearest(class_map == CROSSWALK_CLASS, height, width)
        obstacle = resize_mask_nearest(class_map == OBSTACLE_CLASS, height, width)
        walkable = sidewalk | crosswalk

        total = float(height * width) or 1.0
        return Segmentation(
            walkable=walkable,
            sidewalk_ratio=float(sidewalk.sum()) / total,
            crosswalk_ratio=float(crosswalk.sum()) / total,
            obstacle_ratio=float(obstacle.sum()) / total,
        )

    def _class_map(self, output: np.ndarray) -> np.ndarray:
        raw = np.asarray(output)

        if raw.ndim == 4:
            # [1, C, H, W] logits
            return np.argmax(raw[0], axis=0).astype(np.int32)

        if raw.ndim == 3:
            if raw.shape[0] == 1:
                # [1, H, W] sınıf indeksleri
                return raw[0].astype(np.int32)
            if raw.shape[0] <= 32:
                # [C, H, W] logits
                return np.argmax(raw, axis=0).astype(np.int32)
            # [H, W, 1]
            return raw[:, :, 0].astype(np.int32)

        if raw.ndim == 2:
            return raw.astype(np.int32)

        raise ValueError(f"Beklenmeyen segmentasyon çıktı boyutu: {raw.shape}")
