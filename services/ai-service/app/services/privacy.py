"""KVKK anonimleştirme: yüz ve plaka bölgelerini Gauss ile bulanıklaştırır.

Bu modül **geliştirme/CI için deterministik bir yedek hattır**. Yüz/plaka
tespiti için eğitilmiş bir modele sahip değildir; cilt tonu ve parlak düz
bölge sezgilerini kullanır. Üretimde doğrulanmış bir ONNX modeliyle
değiştirilmelidir (`ALLOW_HEURISTIC_ANONYMIZATION=false` iken uç 503 döner).

Bulanıklaştırma, tespit edilen kutuların tamamına Gauss filtresi uygular.
Böylece yüz/plaka bölgesindeki kimliklendirici detaylar geri döndürülemez
biçimde kaybolur; çıktı yeniden PNG olarak kodlandığı için EXIF (GPS dahil)
taşımaz.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

import numpy as np
from PIL import Image, ImageFilter

PiiKind = Literal["face", "plate"]

#: Tespit için görselin küçültüleceği en büyük kenar (hız / bellek).
DETECTION_MAX_DIMENSION = 640

#: Bulanıklaştırma yarıçapı, bölgenin kısa kenarına göre ölçeklenir.
MIN_BLUR_RADIUS = 6
MAX_BLUR_RADIUS = 96
BLUR_RADIUS_RATIO = 0.35

MIN_FACE_AREA_RATIO = 0.004
MAX_FACE_AREA_RATIO = 0.25
MAX_FACES = 10

MIN_PLATE_AREA_RATIO = 0.0008
MAX_PLATE_AREA_RATIO = 0.06
MAX_PLATES = 10


@dataclass(frozen=True)
class PiiRegion:
    kind: PiiKind
    x1: int
    y1: int
    x2: int
    y2: int
    score: float

    @property
    def width(self) -> int:
        return self.x2 - self.x1

    @property
    def height(self) -> int:
        return self.y2 - self.y1


@dataclass(frozen=True)
class AnonymizeResult:
    image: np.ndarray
    faces: int
    plates: int
    backend: str
    regions: tuple[PiiRegion, ...] = ()


def anonymize_image(rgb: np.ndarray) -> AnonymizeResult:
    """Görseldeki yüz/plaka bölgelerini bulanıklaştırır.

    Args:
        rgb: `HxWx3` uint8 RGB görsel.

    Returns:
        Bulanıklaştırılmış görsel, yüz/plaka sayıları ve tespit kutuları.
    """
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ValueError("Beklenen görsel biçimi HxWx3")

    height, width = rgb.shape[:2]
    small, scale_x, scale_y = _downscale_for_detection(rgb)

    faces = _detect_faces(small)
    plates = _detect_plates(small)

    regions: list[PiiRegion] = []

    for box in faces:
        regions.append(_to_region(box, "face", scale_x, scale_y, width, height))
    for box in plates:
        regions.append(_to_region(box, "plate", scale_x, scale_y, width, height))

    regions = [region for region in regions if region.width >= 4 and region.height >= 4]

    if not regions:
        return AnonymizeResult(image=rgb.copy(), faces=0, plates=0, backend="heuristic")

    blurred = Image.fromarray(rgb, mode="RGB")
    for region in regions:
        blurred = _blur_region(blurred, region)

    return AnonymizeResult(
        image=np.asarray(blurred, dtype=np.uint8),
        faces=sum(1 for region in regions if region.kind == "face"),
        plates=sum(1 for region in regions if region.kind == "plate"),
        backend="heuristic",
        regions=tuple(regions),
    )


def _downscale_for_detection(rgb: np.ndarray) -> tuple[np.ndarray, float, float]:
    height, width = rgb.shape[:2]
    longest = max(height, width)

    if longest <= DETECTION_MAX_DIMENSION:
        return rgb, 1.0, 1.0

    scale = DETECTION_MAX_DIMENSION / longest
    target = (
        max(1, int(round(width * scale))),
        max(1, int(round(height * scale))),
    )
    small = np.asarray(
        Image.fromarray(rgb, mode="RGB").resize(target, Image.Resampling.BILINEAR),
        dtype=np.uint8,
    )

    return small, width / small.shape[1], height / small.shape[0]


def _detect_faces(rgb: np.ndarray) -> list[tuple[int, int, int, int, float]]:
    """Cilt tonu maskesi + bağlı bileşen analizi ile yüz adayları."""
    height, width = rgb.shape[:2]
    red = rgb[:, :, 0].astype(np.float32)
    green = rgb[:, :, 1].astype(np.float32)
    blue = rgb[:, :, 2].astype(np.float32)

    luma = 0.299 * red + 0.587 * green + 0.114 * blue
    cb = 128.0 - 0.168736 * red - 0.331264 * green + 0.5 * blue
    cr = 128.0 + 0.5 * red - 0.418688 * green - 0.081312 * blue

    skin = (
        (cb >= 77)
        & (cb <= 127)
        & (cr >= 133)
        & (cr <= 173)
        & (luma >= 55)
        & (luma <= 245)
    )

    image_area = float(height * width)
    min_area = max(120, int(image_area * MIN_FACE_AREA_RATIO))
    max_area = int(image_area * MAX_FACE_AREA_RATIO)

    candidates: list[tuple[int, int, int, int, float]] = []

    for x1, y1, x2, y2, area in _component_boxes(skin, min_area=min_area):
        box_width = x2 - x1
        box_height = y2 - y1
        if area > max_area:
            continue
        if box_height == 0 or box_width == 0:
            continue

        aspect = box_width / box_height
        if not 0.55 <= aspect <= 1.8:
            continue
        if not 0.02 <= box_height / height <= 0.6:
            continue
        # Yüzler genellikle karenin üst 80%'inde bulunur.
        if (y1 + y2) / 2 > height * 0.8:
            continue

        fill = area / float(box_width * box_height)
        if fill < 0.4:
            continue

        candidates.append((x1, y1, x2, y2, float(area)))

    candidates.sort(key=lambda item: item[4], reverse=True)
    return candidates[:MAX_FACES]


def _detect_plates(rgb: np.ndarray) -> list[tuple[int, int, int, int, float]]:
    """Parlak, yatay ve düşük doygunluktaki dikdörtgen adayları plaka sayar."""
    height, width = rgb.shape[:2]
    red = rgb[:, :, 0].astype(np.int32)
    green = rgb[:, :, 1].astype(np.int32)
    blue = rgb[:, :, 2].astype(np.int32)

    gray = ((red * 299 + green * 587 + blue * 114) // 1000).astype(np.int16)
    saturation = np.maximum(np.maximum(red, green), blue) - np.minimum(
        np.minimum(red, green), blue
    )

    bright = (gray >= 145) & (saturation <= 60)
    # Karakterler arasındaki boşlukları kapatmak için yatay genişletme.
    bright = _dilate_horizontal(bright, radius=4)

    image_area = float(height * width)
    min_area = max(60, int(image_area * MIN_PLATE_AREA_RATIO))
    max_area = int(image_area * MAX_PLATE_AREA_RATIO)

    candidates: list[tuple[int, int, int, int, float]] = []

    for x1, y1, x2, y2, area in _component_boxes(bright, min_area=min_area):
        box_width = x2 - x1
        box_height = y2 - y1
        if area > max_area or box_width == 0 or box_height == 0:
            continue

        aspect = box_width / box_height
        if not 2.0 <= aspect <= 7.5:
            continue
        if not 0.05 <= box_width / width <= 0.5:
            continue
        if not 0.01 <= box_height / height <= 0.18:
            continue
        # Plakalar görselin alt yarısında beklenir.
        if y1 < height * 0.3:
            continue

        fill = area / float(box_width * box_height)
        if fill < 0.45:
            continue

        # Plaka içinde koyu karakterler bulunmalı: tamamen düz parlak alan değil.
        patch = gray[y1:y2, x1:x2]
        if patch.size == 0:
            continue
        dark_ratio = float((patch < 110).sum()) / float(patch.size)
        if not 0.03 <= dark_ratio <= 0.6:
            continue

        candidates.append((x1, y1, x2, y2, float(area)))

    candidates.sort(key=lambda item: item[4], reverse=True)
    return candidates[:MAX_PLATES]


def _component_boxes(
    mask: np.ndarray, *, min_area: int
) -> list[tuple[int, int, int, int, int]]:
    """4-komşuluk bağlı bileşenleri kutulara dönüştürür (deterministik sıra)."""
    height, width = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    boxes: list[tuple[int, int, int, int, int]] = []

    ys, xs = np.nonzero(mask)
    for start_y, start_x in zip(ys.tolist(), xs.tolist()):
        if visited[start_y, start_x]:
            continue

        stack = [(start_y, start_x)]
        visited[start_y, start_x] = True

        min_x = max_x = start_x
        min_y = max_y = start_y
        area = 0

        while stack:
            y, x = stack.pop()
            area += 1

            if x < min_x:
                min_x = x
            elif x > max_x:
                max_x = x
            if y < min_y:
                min_y = y
            elif y > max_y:
                max_y = y

            if x > 0 and mask[y, x - 1] and not visited[y, x - 1]:
                visited[y, x - 1] = True
                stack.append((y, x - 1))
            if x + 1 < width and mask[y, x + 1] and not visited[y, x + 1]:
                visited[y, x + 1] = True
                stack.append((y, x + 1))
            if y > 0 and mask[y - 1, x] and not visited[y - 1, x]:
                visited[y - 1, x] = True
                stack.append((y - 1, x))
            if y + 1 < height and mask[y + 1, x] and not visited[y + 1, x]:
                visited[y + 1, x] = True
                stack.append((y + 1, x))

        if area >= min_area:
            boxes.append((min_x, min_y, max_x + 1, max_y + 1, area))

    return boxes


def _dilate_horizontal(mask: np.ndarray, radius: int) -> np.ndarray:
    """Yatay yönde basit genişletme (karakter boşluklarını birleştirir)."""
    result = mask.copy()
    for offset in range(1, radius + 1):
        result[:, offset:] |= mask[:, :-offset]
        result[:, :-offset] |= mask[:, offset:]
    return result


def _to_region(
    box: tuple[int, int, int, int, float],
    kind: PiiKind,
    scale_x: float,
    scale_y: float,
    image_width: int,
    image_height: int,
) -> PiiRegion:
    x1, y1, x2, y2, area = box

    pad_x = max(2, int((x2 - x1) * 0.12))
    pad_y = max(2, int((y2 - y1) * 0.12))

    return PiiRegion(
        kind=kind,
        x1=max(0, int(math.floor(x1 * scale_x)) - pad_x),
        y1=max(0, int(math.floor(y1 * scale_y)) - pad_y),
        x2=min(image_width, int(math.ceil(x2 * scale_x)) + pad_x),
        y2=min(image_height, int(math.ceil(y2 * scale_y)) + pad_y),
        score=1.0,
    )


def _blur_region(image: Image.Image, region: PiiRegion) -> Image.Image:
    crop = image.crop((region.x1, region.y1, region.x2, region.y2))
    radius = min(
        MAX_BLUR_RADIUS,
        max(MIN_BLUR_RADIUS, int(min(region.width, region.height) * BLUR_RADIUS_RATIO)),
    )
    blurred = crop.filter(ImageFilter.GaussianBlur(radius=radius))
    result = image.copy()
    result.paste(blurred, (region.x1, region.y1))
    return result
