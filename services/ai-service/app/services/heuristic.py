"""Ağırlık bulunmadığında kullanılan deterministik geliştirme hattı.

Bu hat **doğruluk iddiası taşımaz**. Amaç, model ağırlıkları olmadan da
uçtan uca akışın (API, overlap, skor, karar) çalıştığını göstermek ve
CI testlerini modele bağımlı kılmamaktır. Üretimde ONNX modelleri
`models/` dizinine konduğunda otomatik olarak devre dışı kalır.
"""

from __future__ import annotations

from collections import deque

import numpy as np
from PIL import Image

from app.services.detector import Detection
from app.services.segmenter import Segmentation

#: Yürünebilir alan kabul edilen alt bant oranı (perspektif varsayımı).
WALKABLE_BAND_START = 0.35

HEURISTIC_CONFIDENCE_BASE = 0.50
HEURISTIC_MAX_BOXES = 8
MIN_COMPONENT_AREA_RATIO = 0.004
MAX_COMPONENT_AREA_RATIO = 0.60


def heuristic_detect(rgb: np.ndarray) -> list[Detection]:
    height, width = rgb.shape[:2]

    working_width = min(160, width)
    working_height = max(1, int(round(height * working_width / width)))
    small = np.asarray(
        Image.fromarray(rgb).resize((working_width, working_height), Image.Resampling.BILINEAR)
    )

    foreground = _foreground_mask(small)
    components = _components(foreground)

    total_pixels = float(working_height * working_width) or 1.0
    scale_x = width / working_width
    scale_y = height / working_height

    detections: list[Detection] = []

    for (left, top, right, bottom, area_px) in components:
        area_ratio = area_px / total_pixels
        if area_ratio < MIN_COMPONENT_AREA_RATIO or area_ratio > MAX_COMPONENT_AREA_RATIO:
            continue

        x1 = max(0.0, left * scale_x)
        y1 = max(0.0, top * scale_y)
        x2 = min(float(width), right * scale_x)
        y2 = min(float(height), bottom * scale_y)

        if x2 - x1 < 2 or y2 - y1 < 2:
            continue

        confidence = min(
            0.85, HEURISTIC_CONFIDENCE_BASE + min(0.35, area_ratio * 4.0)
        )

        detections.append(
            Detection(
                label="street_furniture",
                class_id=2,
                confidence=float(confidence),
                x1=x1,
                y1=y1,
                x2=x2,
                y2=y2,
            )
        )

    detections.sort(key=lambda item: item.confidence, reverse=True)
    return detections[:HEURISTIC_MAX_BOXES]


def heuristic_segment(rgb: np.ndarray) -> Segmentation:
    height, width = rgb.shape[:2]
    walkable = np.zeros((height, width), dtype=bool)
    walkable[int(height * WALKABLE_BAND_START) :, :] = True

    return Segmentation(
        walkable=walkable,
        sidewalk_ratio=float(walkable.mean()),
        crosswalk_ratio=0.0,
        obstacle_ratio=0.0,
    )


def _foreground_mask(image: np.ndarray) -> np.ndarray:
    """Doygun renkli veya çok koyu bölgeleri ön plan kabul eder."""
    values = image.astype(np.float32) / 255.0
    max_channel = values.max(axis=2)
    min_channel = values.min(axis=2)
    delta = max_channel - min_channel

    saturation = np.where(max_channel > 0, delta / np.maximum(max_channel, 1e-6), 0.0)

    colorful = (saturation > 0.45) & (max_channel > 0.20)
    very_dark = max_channel < 0.18

    return colorful | very_dark


def _components(mask: np.ndarray) -> list[tuple[int, int, int, int, int]]:
    """4-komşuluk BFS ile bağlı bileşenleri ve sınırlayıcı kutularını bulur."""
    height, width = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    results: list[tuple[int, int, int, int, int]] = []

    for start_y in range(height):
        for start_x in range(width):
            if not mask[start_y, start_x] or visited[start_y, start_x]:
                continue

            queue: deque[tuple[int, int]] = deque([(start_y, start_x)])
            visited[start_y, start_x] = True

            min_x = max_x = start_x
            min_y = max_y = start_y
            area = 0

            while queue:
                y, x = queue.popleft()
                area += 1
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)

                for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= ny < height and 0 <= nx < width:
                        if mask[ny, nx] and not visited[ny, nx]:
                            visited[ny, nx] = True
                            queue.append((ny, nx))

            results.append((min_x, min_y, max_x + 1, max_y + 1, area))

    results.sort(key=lambda item: item[4], reverse=True)
    return results
