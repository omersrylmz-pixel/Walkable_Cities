"""`POST /v1/analyze` — görselden ihlal analizi."""

from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile

from app.schemas.analysis import AnalyzeResponse
from app.services.analyzer import Analyzer, normalize_request_id
from app.services.imaging import ALLOWED_MIME_TYPES, ImageDecodeError, ImageTooLargeError
from app.services.onnx_models import ModelRegistry

router = APIRouter(prefix="/v1", tags=["analysis"])


@router.post(
    "/analyze",
    response_model=AnalyzeResponse,
    summary="Görsel analizi",
    description=(
        "Yüklenen görselde engel tespiti ve yürünebilir alan segmentasyonu yapar; "
        "overlap oranını, kalibre edilmiş güven skorunu ve karar bandını döndürür. "
        "Aynı görsel + aynı model sürümü deterministik sonuç üretir."
    ),
    responses={
        413: {"description": "Görsel boyutu sınırı aşıyor"},
        415: {"description": "Desteklenmeyen görsel biçimi"},
        422: {"description": "Görsel çözülemedi veya alanlar geçersiz"},
        503: {"description": "Model hazır değil"},
    },
)
async def analyze_image(
    request: Request,
    response: Response,
    image: UploadFile = File(..., description="JPEG, PNG veya WebP görsel"),
    include_mask: bool = Form(
        False,
        alias="includeMask",
        description="Yürünebilir alan maskesini RLE olarak da döndür",
    ),
) -> AnalyzeResponse:
    settings = request.app.state.settings
    registry: ModelRegistry = request.app.state.registry
    analyzer: Analyzer = request.app.state.analyzer

    if not registry.ready:
        raise HTTPException(
            status_code=503,
            detail="Model ağırlıkları yüklü değil ve yedek hat devre dışı.",
        )

    declared_mime = (image.content_type or "").split(";")[0].strip().lower() or None
    if (
        declared_mime
        and declared_mime not in ALLOWED_MIME_TYPES
        and declared_mime != "application/octet-stream"
    ):
        raise HTTPException(
            status_code=415,
            detail=(
                f"Desteklenmeyen içerik türü: {declared_mime}. "
                "JPEG, PNG veya WebP yükleyin."
            ),
        )

    data = await image.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise ImageTooLargeError(
            f"Görsel boyutu {settings.max_upload_mb} MB sınırını aşıyor"
        )

    if not data:
        raise ImageDecodeError("Görsel verisi boş")

    result = analyzer.analyze(
        data,
        declared_mime=declared_mime,
        include_mask=include_mask,
        request_id=normalize_request_id(request.headers.get("x-request-id")),
    )

    response.headers["X-Request-ID"] = result.request_id
    response.headers["X-Inference-Backend"] = result.backend
    response.headers["X-Model-Version"] = result.model_version

    return result
