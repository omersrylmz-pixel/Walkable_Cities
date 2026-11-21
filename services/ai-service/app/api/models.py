"""`GET /v1/models` — yüklü model sürümleri ve çıkarım ayarları."""

from __future__ import annotations

from fastapi import APIRouter, Request

from app.schemas.analysis import ModelVersion, ModelsResponse, Thresholds
from app.services.onnx_models import ModelRegistry

router = APIRouter(prefix="/v1", tags=["models"])


@router.get(
    "/models",
    response_model=ModelsResponse,
    summary="Model durumu",
    description="Yüklü ONNX modellerini, sürümlerini ve karar eşiklerini döndürür.",
)
async def list_models(request: Request) -> ModelsResponse:
    settings = request.app.state.settings
    registry: ModelRegistry = request.app.state.registry

    return ModelsResponse(
        backend="onnx" if registry.backend == "onnx" else "heuristic",
        ready=registry.ready,
        models=[ModelVersion(**entry) for entry in registry.describe()],
        decision_thresholds=Thresholds(
            auto_accept=settings.auto_accept_threshold,
            manual_review=settings.manual_review_threshold,
        ),
        score_temperature=settings.score_temperature,
        class_schema=registry.class_names,
        analysis_max_dimension=settings.analysis_max_dimension,
    )
