"""AI servisi test yardımcıları."""

from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import Settings
from app.main import create_app


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        model_dir=str(tmp_path / "models"),
        allow_heuristic_fallback=True,
        warmup_on_startup=False,
        analysis_max_dimension=384,
        max_upload_mb=1,
    )


@pytest.fixture
def client(settings: Settings) -> TestClient:
    app = create_app(settings)
    with TestClient(app) as test_client:
        yield test_client


def make_scene(
    *,
    width: int = 320,
    height: int = 240,
    block: tuple[int, int, int, int] | None = (100, 140, 180, 220),
) -> np.ndarray:
    """Açık gri zeminde koyu dikdörtgen içeren sentetik sahne."""
    scene = np.full((height, width, 3), 200, dtype=np.uint8)
    scene[height // 2 :, :, :] = 190

    if block is not None:
        x1, y1, x2, y2 = block
        scene[y1:y2, x1:x2] = (12, 12, 12)

    return scene


def encode_png(array: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(array).save(buffer, format="PNG", optimize=False)
    return buffer.getvalue()


def encode_jpeg(array: np.ndarray, quality: int = 85) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(array).save(buffer, format="JPEG", quality=quality)
    return buffer.getvalue()
