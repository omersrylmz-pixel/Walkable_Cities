"""KVKK anonimleştirme: yüz/plaka bulanıklaştırma ve `/v1/anonymize` testleri."""

from __future__ import annotations

import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import Settings
from app.main import create_app
from app.services.privacy import anonymize_image

from .conftest import encode_png


def make_pii_scene(width: int = 320, height: int = 240) -> np.ndarray:
    """Sentetik sahne: dokulu cilt tonlu yüz + koyu karakterli parlak plaka."""
    scene = np.full((height, width, 3), 90, dtype=np.uint8)

    # Yüz: cilt tonu aralığında kalan iki tonla dokulanmış kutu.
    scene[40:110, 120:180] = (200, 160, 140)
    scene[45:60, 125:145] = (215, 175, 155)
    scene[60:75, 150:170] = (185, 145, 125)

    # Plaka: parlak zemin + koyu karakter çubukları.
    scene[170:200, 110:210] = (230, 230, 230)
    for index in range(4):
        x = 120 + 22 * index
        scene[175:195, x : x + 3] = (20, 20, 20)

    return scene


def make_plain_scene(width: int = 320, height: int = 240) -> np.ndarray:
    """Kimliklendirici bölge içermeyen düz gri sahne."""
    return np.full((height, width, 3), 128, dtype=np.uint8)


def luma(array: np.ndarray) -> np.ndarray:
    return np.asarray(Image.fromarray(array).convert('L'), dtype=np.float32)


def _post(client: TestClient, body: bytes, mime: str = 'image/png'):
    return client.post(
        '/v1/anonymize',
        files={'image': ('scene.png', body, mime)},
    )


def test_detects_face_and_plate_regions() -> None:
    result = anonymize_image(make_pii_scene())

    assert result.backend == 'heuristic'
    assert result.faces == 1
    assert result.plates == 1
    assert {region.kind for region in result.regions} == {'face', 'plate'}


def test_blur_reduces_variance_in_pii_regions() -> None:
    scene = make_pii_scene()
    result = anonymize_image(scene)

    before = luma(scene)
    after = luma(result.image)

    face_before = before[35:120, 110:190].var()
    face_after = after[35:120, 110:190].var()
    plate_before = before[165:205, 90:230].var()
    plate_after = after[165:205, 90:230].var()

    assert face_after < face_before * 0.5
    assert plate_after < plate_before * 0.5
    assert not np.array_equal(result.image, scene)


def test_image_without_pii_is_returned_unchanged() -> None:
    scene = make_plain_scene()
    result = anonymize_image(scene)

    assert result.faces == 0
    assert result.plates == 0
    assert result.regions == ()
    assert np.array_equal(result.image, scene)


def test_anonymization_is_deterministic() -> None:
    scene = make_pii_scene()
    first = anonymize_image(scene)
    second = anonymize_image(scene)

    assert first.faces == second.faces
    assert first.plates == second.plates
    assert first.regions == second.regions
    assert np.array_equal(first.image, second.image)


def test_endpoint_returns_png_with_detection_headers(client: TestClient) -> None:
    response = _post(client, encode_png(make_pii_scene()))

    assert response.status_code == 200
    assert response.headers['content-type'].startswith('image/png')
    assert response.headers['x-anonymizer-backend'] == 'heuristic'
    assert response.headers['x-faces-blurred'] == '1'
    assert response.headers['x-plates-blurred'] == '1'
    assert response.headers['x-image-width'] == '320'
    assert response.headers['x-image-height'] == '240'
    assert response.headers['cache-control'] == 'no-store'
    assert response.content.startswith(b'\x89PNG\r\n\x1a\n')

    decoded = Image.open(io.BytesIO(response.content))
    assert decoded.format == 'PNG'
    assert decoded.size == (320, 240)
    # Anonimleştirilmiş çıktı EXIF (dolayısıyla GPS) taşımamalı.
    assert not decoded.getexif()


def test_endpoint_accepts_request_id(client: TestClient) -> None:
    response = client.post(
        '/v1/anonymize',
        files={'image': ('scene.png', encode_png(make_pii_scene()), 'image/png')},
        headers={'X-Request-ID': 'privacy-test-1'},
    )

    assert response.status_code == 200
    assert response.headers['x-request-id'] == 'privacy-test-1'


def test_endpoint_rejects_unsupported_declared_type(client: TestClient) -> None:
    response = _post(client, b'not an image', mime='text/plain')

    assert response.status_code == 415
    assert response.headers['content-type'].startswith('application/problem+json')


def test_endpoint_rejects_undecodable_image(client: TestClient) -> None:
    response = _post(client, b'missing image bytes', mime='image/png')

    assert response.status_code == 422
    assert response.json()['type'].endswith('/invalid-image')


def test_endpoint_rejects_oversized_body(client: TestClient) -> None:
    # `max_upload_mb=1`; multipart toleransıyla birlikte ~2 MB üstü reddedilir.
    oversized = b'\x00' * (3 * 1024 * 1024)
    response = _post(client, oversized)

    assert response.status_code == 413
    assert response.headers['content-type'].startswith('application/problem+json')


def test_endpoint_returns_503_when_heuristic_disabled(settings: Settings) -> None:
    disabled = settings.model_copy(update={'allow_heuristic_anonymization': False})
    app = create_app(disabled)

    with TestClient(app) as disabled_client:
        response = _post(disabled_client, encode_png(make_pii_scene()))

    assert response.status_code == 503
    assert response.headers['content-type'].startswith('application/problem+json')


def test_endpoint_requires_image_field(client: TestClient) -> None:
    response = client.post('/v1/anonymize', files={'other': ('a.txt', b'x', 'text/plain')})

    assert response.status_code == 422
    assert response.headers['content-type'].startswith('application/problem+json')
