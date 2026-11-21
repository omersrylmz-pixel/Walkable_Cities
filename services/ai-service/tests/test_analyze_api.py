"""`/v1/analyze`, `/v1/models` ve hazırlık ucu entegrasyon testleri."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services.imaging import rle_decode

from .conftest import encode_png, make_scene


def _analyze(client: TestClient, *, include_mask: bool = False, request_id: str | None = None):
    headers = {"X-Request-ID": request_id} if request_id else None
    data = {"includeMask": "true"} if include_mask else None

    return client.post(
        "/v1/analyze",
        files={"image": ("scene.png", encode_png(make_scene()), "image/png")},
        data=data,
        headers=headers,
    )


def _stable_payload(body: dict[str, Any]) -> dict[str, Any]:
    return {
        "backend": body["backend"],
        "modelVersion": body["modelVersion"],
        "image": body["image"],
        "detections": body["detections"],
        "segmentation": {
            key: value for key, value in body["segmentation"].items() if key != "mask"
        },
        "metrics": body["metrics"],
        "score": body["score"],
        "decision": body["decision"],
    }


def test_analyze_returns_full_pipeline_result(client: TestClient) -> None:
    response = _analyze(client, request_id="test-request-1")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.headers["x-request-id"] == "test-request-1"
    assert response.headers["x-inference-backend"] == "heuristic"

    body = response.json()
    assert body["backend"] == "heuristic"
    assert body["requestId"] == "test-request-1"
    assert body["image"]["width"] == 320
    assert body["image"]["height"] == 240
    assert body["image"]["originalWidth"] == 320
    assert body["image"]["originalHeight"] == 240
    assert body["detections"], "Sentetik sahnede en az bir engel bulunmalı"
    assert body["metrics"]["detectionCount"] == len(body["detections"])
    assert 0.0 <= body["score"]["raw"] <= 1.0
    assert body["decision"]["outcome"] in {"auto_accept", "manual_review", "auto_reject"}
    assert body["segmentation"]["walkableAreaRatio"] == pytest.approx(0.65, abs=0.01)
    assert body["segmentation"]["mask"] is None
    assert body["latency"]["totalMs"] >= 0


def test_analyze_is_deterministic_for_same_image(client: TestClient) -> None:
    first = _analyze(client)
    second = _analyze(client)

    assert first.status_code == second.status_code == 200
    assert _stable_payload(first.json()) == _stable_payload(second.json())


def test_analyze_returns_rle_mask_on_request(client: TestClient) -> None:
    response = _analyze(client, include_mask=True)

    assert response.status_code == 200
    mask = response.json()["segmentation"]["mask"]
    assert mask["encoding"] == "rle_counts"
    assert mask["size"] == [240, 320]

    decoded = rle_decode(mask["counts"], height=240, width=320)
    assert decoded.shape == (240, 320)
    assert decoded.sum() == pytest.approx(240 * 320 * 0.65, abs=200)


def test_analysis_flags_large_obstruction_for_manual_or_auto_decision(
    client: TestClient,
) -> None:
    wide_block = make_scene(block=(40, 120, 280, 235))
    response = client.post(
        "/v1/analyze",
        files={"image": ("wide.png", encode_png(wide_block), "image/png")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["obstructionRatio"] > 0.2
    assert body["decision"]["outcome"] in {"auto_accept", "manual_review"}


def test_analyze_rejects_unsupported_media_type(client: TestClient) -> None:
    response = client.post(
        "/v1/analyze",
        files={"image": ("scene.txt", b"hello", "text/plain")},
    )

    assert response.status_code == 415
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["type"].endswith("/unsupported-media-type")


def test_analyze_rejects_invalid_image_bytes(client: TestClient) -> None:
    response = client.post(
        "/v1/analyze",
        files={"image": ("scene.png", b"not-an-image", "image/png")},
    )

    assert response.status_code == 422
    assert response.json()["type"].endswith("/invalid-image")


def test_analyze_rejects_missing_file(client: TestClient) -> None:
    response = client.post("/v1/analyze")

    assert response.status_code == 422
    assert response.json()["type"].endswith("/validation-error")
    assert response.json()["errors"]


def test_analyze_enforces_upload_limit(tmp_path) -> None:
    settings = Settings(
        model_dir=str(tmp_path / "models"),
        allow_heuristic_fallback=True,
        warmup_on_startup=False,
        max_upload_mb=0,
    )

    with TestClient(create_app(settings)) as limited_client:
        response = limited_client.post(
            "/v1/analyze",
            files={"image": ("scene.png", encode_png(make_scene()), "image/png")},
        )

    assert response.status_code == 413
    assert response.json()["type"].endswith("/payload-too-large")


def test_models_endpoint_describes_registry(client: TestClient) -> None:
    response = client.get("/v1/models")

    assert response.status_code == 200
    body = response.json()
    assert body["backend"] == "heuristic"
    assert body["ready"] is True
    assert [model["role"] for model in body["models"]] == ["detector", "segmenter"]
    assert all(model["loaded"] is False for model in body["models"])
    assert all(model["error"] for model in body["models"])
    assert body["decisionThresholds"] == {"autoAccept": 0.85, "manualReview": 0.6}
    assert body["scoreTemperature"] == 1.0
    assert len(body["classSchema"]) == 6


def test_readiness_reports_heuristic_fallback(client: TestClient) -> None:
    response = client.get("/health/ready")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["inferenceBackend"] == "heuristic"
    assert body["allowHeuristicFallback"] is True


def test_readiness_and_analyze_fail_when_fallback_disabled(tmp_path) -> None:
    settings = Settings(
        model_dir=str(tmp_path / "models"),
        allow_heuristic_fallback=False,
        warmup_on_startup=False,
    )

    with TestClient(create_app(settings)) as strict_client:
        readiness = strict_client.get("/health/ready")
        analysis = strict_client.post(
            "/v1/analyze",
            files={"image": ("scene.png", encode_png(make_scene()), "image/png")},
        )

    assert readiness.status_code == 503
    assert readiness.json()["status"] == "not_ready"
    assert analysis.status_code == 503
