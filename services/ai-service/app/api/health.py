"""Sağlık ve hazırlık uçları.

Faz 2'de `/health/ready`, ONNX Runtime oturumlarının ve model
ağırlıklarının yüklenip yüklenmediğini doğrulayacak.
"""

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter

from app.core.config import get_settings

router = APIRouter(tags=["health"])


@router.get("/health", summary="Liveness")
async def health() -> dict[str, Any]:
    settings = get_settings()
    return {
        "status": "ok",
        "service": settings.app_name,
        "environment": settings.environment,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/health/ready", summary="Readiness")
async def ready() -> dict[str, Any]:
    settings = get_settings()
    return {
        "status": "ready",
        "inference_backend": "onnxruntime (Faz 2'de etkinleştirilecek)",
        "model_dir": settings.model_dir,
        "decision_thresholds": settings.thresholds,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
