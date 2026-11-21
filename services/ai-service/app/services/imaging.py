"""Görüntü çözme, yeniden boyutlandırma ve maske kodlama yardımcıları."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from io import BytesIO

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

ALLOWED_MIME_TYPES = ("image/jpeg", "image/png", "image/webp")
ALLOWED_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


class ImageDecodeError(ValueError):
    """Görsel çözülemedi veya desteklenmeyen bir biçimde."""


class ImageTooLargeError(ImageDecodeError):
    """Yükleme boyutu veya piksel boyutu sınırı aşıldı."""


class UnsupportedImageError(ImageDecodeError):
    """Desteklenmeyen görsel biçimi veya içerik türü uyuşmazlığı."""


@dataclass(frozen=True)
class DecodedImage:
    rgb: np.ndarray  # HxWx3, uint8
    width: int
    height: int
    original_width: int
    original_height: int
    mime_type: str
    sha256: str
    byte_size: int

    @property
    def shape(self) -> tuple[int, int]:
        return self.height, self.width


def decode_image(
    data: bytes,
    *,
    max_bytes: int,
    max_dimension: int,
    target_max_dimension: int | None = None,
    declared_mime: str | None = None,
) -> DecodedImage:
    """Baytlardan RGB görsel üretir.

    - Boyut sınırı: `max_bytes`
    - EXIF yönü uygulanır, alfa kanalı beyaza kompozitlenir.
    - Uzun kenar `target_max_dimension`'ı aşarsa orantılı küçültülür.
    - `max_dimension` mutlak üst sınırdır; aşılırsa istek reddedilir.
    """
    if not data:
        raise ImageDecodeError("Görsel verisi boş")

    if len(data) > max_bytes:
        raise ImageTooLargeError(
            f"Görsel boyutu {max_bytes // (1024 * 1024)} MB sınırını aşıyor"
        )

    try:
        with Image.open(BytesIO(data)) as probe:
            fmt = (probe.format or "").upper()
            width, height = probe.size
    except (UnidentifiedImageError, OSError) as exc:
        raise ImageDecodeError("Dosya geçerli bir görsel değil") from exc

    if fmt not in ALLOWED_FORMATS:
        raise UnsupportedImageError(f"Desteklenmeyen görsel biçimi: {fmt or 'bilinmiyor'}")

    mime_type = ALLOWED_FORMATS[fmt]
    if declared_mime and declared_mime not in ("application/octet-stream", mime_type):
        raise UnsupportedImageError(
            f"Bildirilen içerik türü ({declared_mime}) ile dosya içeriği ({mime_type}) uyuşmuyor"
        )

    if width <= 0 or height <= 0:
        raise ImageDecodeError("Görsel boyutları geçersiz")

    if max(width, height) > max_dimension:
        raise ImageTooLargeError(
            f"Görsel kenarı {max_dimension} piksel sınırını aşıyor"
        )

    target_limit = target_max_dimension or max_dimension

    try:
        with Image.open(BytesIO(data)) as image:
            image = ImageOps.exif_transpose(image)
            original_width, original_height = image.size
            image = _flatten_alpha(image)
            image = image.convert("RGB")

            if max(image.size) > target_limit:
                scale = target_limit / max(image.size)
                target = (
                    max(1, int(round(image.width * scale))),
                    max(1, int(round(image.height * scale))),
                )
                image = image.resize(target, Image.Resampling.BILINEAR)

            rgb = np.asarray(image, dtype=np.uint8)
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ImageDecodeError("Görsel çözülemedi") from exc

    return DecodedImage(
        rgb=np.ascontiguousarray(rgb),
        width=int(rgb.shape[1]),
        height=int(rgb.shape[0]),
        original_width=int(original_width),
        original_height=int(original_height),
        mime_type=mime_type,
        sha256=hashlib.sha256(data).hexdigest(),
        byte_size=len(data),
    )


def _flatten_alpha(image: Image.Image) -> Image.Image:
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        return Image.alpha_composite(background, rgba).convert("RGB")
    return image


def resize_rgb(image: np.ndarray, width: int, height: int) -> np.ndarray:
    """RGB dizisini hedef boyuta getirir (bilinear)."""
    if image.shape[1] == width and image.shape[0] == height:
        return image
    resized = Image.fromarray(image).resize((width, height), Image.Resampling.BILINEAR)
    return np.asarray(resized, dtype=np.uint8)


def letterbox(
    image: np.ndarray,
    size: int,
    pad_value: int = 114,
) -> tuple[np.ndarray, float, int, int]:
    """Kare giriş için orantılı ölçekleme + dolgu.

    Dönen değerler: (padded RGB, ölçek, pad_x, pad_y)
    """
    height, width = image.shape[:2]
    scale = min(size / width, size / height)
    new_width = max(1, int(round(width * scale)))
    new_height = max(1, int(round(height * scale)))

    resized = resize_rgb(image, new_width, new_height)
    canvas = np.full((size, size, 3), pad_value, dtype=np.uint8)

    pad_x = (size - new_width) // 2
    pad_y = (size - new_height) // 2
    canvas[pad_y : pad_y + new_height, pad_x : pad_x + new_width] = resized

    return canvas, scale, pad_x, pad_y


def to_nchw(image: np.ndarray) -> np.ndarray:
    """HxWx3 uint8 -> 1x3xHxW float32 (0–1)."""
    chw = np.transpose(image.astype(np.float32) / 255.0, (2, 0, 1))
    return np.ascontiguousarray(chw[np.newaxis, ...])


def resize_mask_nearest(mask: np.ndarray, height: int, width: int) -> np.ndarray:
    """Bool maskeyi en yakın komşu ile hedef boyuta getirir."""
    source_h, source_w = mask.shape[:2]
    if source_h == height and source_w == width:
        return mask.astype(bool)

    row_index = np.clip((np.arange(height) * source_h // max(1, height)), 0, source_h - 1)
    col_index = np.clip((np.arange(width) * source_w // max(1, width)), 0, source_w - 1)

    return mask[row_index[:, None], col_index[None, :]].astype(bool)


def rle_encode(mask: np.ndarray) -> list[int]:
    """Satır-öncelikli RLE. İlk çalışma değeri 0 kabul edilir."""
    flat = mask.astype(np.uint8).reshape(-1)
    if flat.size == 0:
        return []

    counts: list[int] = []
    previous = 0
    run = 0

    for value in flat:
        if int(value) == previous:
            run += 1
        else:
            counts.append(run)
            previous = int(value)
            run = 1

    counts.append(run)
    return counts


def rle_decode(counts: list[int], height: int, width: int) -> np.ndarray:
    """RLE'yi bool maskeye çevirir (test ve doğrulama için)."""
    values: list[np.ndarray] = []
    current = 0

    for count in counts:
        values.append(np.full(count, current, dtype=np.uint8))
        current = 1 - current

    flat = np.concatenate(values) if values else np.empty(0, dtype=np.uint8)
    expected = height * width
    if flat.size != expected:
        raise ValueError(f"RLE boyutu uyuşmuyor: {flat.size} != {expected}")

    return flat.reshape(height, width).astype(bool)


def boxes_to_mask(boxes: list[tuple[float, float, float, float]], height: int, width: int) -> np.ndarray:
    """xyxy kutularının birleşiminden bool maske üretir."""
    mask = np.zeros((height, width), dtype=bool)

    for x1, y1, x2, y2 in boxes:
        left = max(0, min(width, int(np.floor(x1))))
        top = max(0, min(height, int(np.floor(y1))))
        right = max(0, min(width, int(np.ceil(x2))))
        bottom = max(0, min(height, int(np.ceil(y2))))

        if right > left and bottom > top:
            mask[top:bottom, left:right] = True

    return mask
