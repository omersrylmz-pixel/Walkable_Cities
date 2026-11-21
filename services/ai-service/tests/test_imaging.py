"""Görüntü çözme, letterbox ve RLE testleri."""

from __future__ import annotations

import numpy as np
import pytest

from app.services.imaging import (
    ImageDecodeError,
    ImageTooLargeError,
    UnsupportedImageError,
    decode_image,
    letterbox,
    rle_decode,
    rle_encode,
)

from .conftest import encode_jpeg, encode_png, make_scene


def test_decode_png_preserves_size_and_metadata() -> None:
    data = encode_png(make_scene())

    decoded = decode_image(data, max_bytes=5_000_000, max_dimension=2048)

    assert (decoded.width, decoded.height) == (320, 240)
    assert decoded.mime_type == "image/png"
    assert decoded.byte_size == len(data)
    assert len(decoded.sha256) == 64
    assert decoded.rgb.shape == (240, 320, 3)
    assert decoded.rgb.dtype == np.uint8


def test_decode_jpeg_downscales_to_target_dimension() -> None:
    data = encode_jpeg(make_scene(width=800, height=600))

    decoded = decode_image(
        data,
        max_bytes=5_000_000,
        max_dimension=2048,
        target_max_dimension=400,
    )

    assert max(decoded.width, decoded.height) == 400
    assert (decoded.original_width, decoded.original_height) == (800, 600)
    assert decoded.width / decoded.height == pytest.approx(800 / 600, rel=0.02)


def test_decode_rejects_mime_mismatch() -> None:
    data = encode_png(make_scene())

    with pytest.raises(UnsupportedImageError):
        decode_image(
            data,
            max_bytes=5_000_000,
            max_dimension=2048,
            declared_mime="image/jpeg",
        )


def test_decode_rejects_non_image_bytes() -> None:
    with pytest.raises(ImageDecodeError):
        decode_image(b"not-an-image", max_bytes=1024, max_dimension=2048)


def test_decode_rejects_blob_over_byte_limit() -> None:
    data = encode_png(make_scene())

    with pytest.raises(ImageTooLargeError):
        decode_image(data, max_bytes=8, max_dimension=2048)


def test_decode_rejects_oversized_pixels() -> None:
    data = encode_png(make_scene(width=800, height=600))

    with pytest.raises(ImageTooLargeError):
        decode_image(data, max_bytes=5_000_000, max_dimension=500)


def test_letterbox_keeps_aspect_ratio_and_padding() -> None:
    image = make_scene(width=320, height=240)

    padded, scale, pad_x, pad_y = letterbox(image, 640)

    assert padded.shape == (640, 640, 3)
    assert scale == pytest.approx(2.0)
    assert pad_x == 0
    assert pad_y == pytest.approx(80)
    # Üstteki dolgu 114 ile boyanır.
    assert padded[0, 0, 0] == 114
    assert padded[100, 100, 0] == image[10, 50, 0]


def test_rle_roundtrip() -> None:
    mask = np.zeros((7, 11), dtype=bool)
    mask[2:5, 3:9] = True

    counts = rle_encode(mask)
    restored = rle_decode(counts, height=7, width=11)

    assert counts[0] == 2 * 11 + 3
    np.testing.assert_array_equal(mask, restored)


def test_rle_decode_rejects_size_mismatch() -> None:
    with pytest.raises(ValueError):
        rle_decode([1, 2, 3], height=10, width=10)
