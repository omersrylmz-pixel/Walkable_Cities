"""Sağlık ve hazırlık uçları.

`/health` yalnızca sürecin yaşadığını bildirir (Docker healthcheck).
`/health/ready` ise ONNX oturumlarının yüklenip yüklenmediğini ve yedek
hattın kullanılabilirliğini denetler; hazır değilse 503 döner.
"""

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.services.onnx_models import ModelRegistry

router = APIRouter(tags=["health"])


@router.get("/health", summary="Liveness")
async def health(request: Request) -> dict[str, Any]:
    settings = getattr(request.app.state, "settings", None) or get_settings()
    return {
        "status": "ok",
        "service": settings.app_name,
        "environment": settings.environment,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/health/ready", summary="Readiness")
async def ready(request: Request) -> JSONResponse:
    settings = getattr(request.app.state, "settings", None) or get_settings()
    registry: ModelRegistry | None = getattr(request.app.state, "registry", None)

    if registry is None:
        return JSONResponse(
            status_code=503,
            content={
                "status": "starting",
                "detail": "Model kaydı henüz yüklenmedi.",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )

    is_ready = registry.ready
    payload: dict[str, Any] = {
        "status": "ready" if is_ready else "not_ready",
        "inferenceBackend": registry.backend,
        "modelVersion": registry.model_version,
        "modelDir": settings.model_dir,
        "models": [
            {
                "role": entry["role"],
                "name": entry["name"],
                "version": entry["version"],
                "loaded": entry["loaded"],
                "path": entry["path"],
                "inputSize": entry["input_size"],
                "error": entry["error"],
            }
            for entry in registry.describe()
        ],
        "allowHeuristicFallback": settings.allow_heuristic_fallback,
        "decisionThresholds": {
            "autoAccept": settings.auto_accept_threshold,
            "manualReview": settings.manual_review_threshold,
        },
        "scoreTemperature": settings.score_temperature,
        "warmupMs": registry.warmup_ms,
        "loadedAt": (
            datetime.fromtimestamp(registry.loaded_at, tz=timezone.utc).isoformat()
            if registry.loaded_at
            else None
        ),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    if not is_ready:
        payload["detail"] = (
            "ONNX modelleri yüklü değil ve ALLOW_HEURISTIC_FALLBACK kapalı."
        )

    return JSONResponse(status_code=200 if is_ready else 503, content=payload)
