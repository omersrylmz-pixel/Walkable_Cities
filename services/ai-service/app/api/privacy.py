"""`POST /v1/anonymize` — KVKK için yüz/plaka bulanıklaştırma."""

from __future__ import annotations

from io import BytesIO

from fastapi import APIRouter, File, HTTPException, Request, Response, UploadFile
from PIL import Image

from app.services.analyzer import normalize_request_id
from app.services.imaging import ALLOWED_MIME_TYPES, ImageDecodeError, ImageTooLargeError, decode_image
from app.services.privacy import anonymize_image

router = APIRouter(prefix="/v1", tags=["privacy"])


@router.post(
    "/anonymize",
    summary="Yüz/plaka anonimleştirme",
    description=(
        "Yüklenen görselde yüz ve plaka bölgelerini Gauss ile bulanıklaştırır ve "
        "EXIF içermeyen PNG döndürür. Tespit sayıları yanıt başlıklarında "
        "(`X-Faces-Blurred`, `X-Plates-Blurred`) bildirilir. Orijinal görsel "
        "çağıran servis tarafından ayrı ve erişimi kısıtlı olarak saklanmalıdır."
    ),
    responses={
        200: {"content": {"image/png": {}}, "description": "Anonimleştirilmiş PNG"},
        413: {"description": "Görsel boyutu sınırı aşıyor"},
        415: {"description": "Desteklenmeyen görsel biçimi"},
        422: {"description": "Görsel çözülemedi"},
        503: {"description": "Anonimleştirme modeli/hint devre dışı"},
    },
    response_class=Response,
)
async def anonymize(
    request: Request,
    image: UploadFile = File(..., description="JPEG, PNG veya WebP görsel"),
) -> Response:
    settings = request.app.state.settings

    if not settings.allow_heuristic_anonymization:
        raise HTTPException(
            status_code=503,
            detail=(
                "Yüz/plaka anonimleştirme devre dışı ve doğrulanmış model yüklü değil."
            ),
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

    decoded = decode_image(
        data,
        max_bytes=settings.max_upload_bytes,
        max_dimension=settings.max_image_dimension,
        declared_mime=declared_mime,
    )
    result = anonymize_image(decoded.rgb)

    buffer = BytesIO()
    Image.fromarray(result.image, mode="RGB").save(buffer, format="PNG", optimize=False)

    request_id = normalize_request_id(request.headers.get("x-request-id"))
    headers = {
        "X-Anonymizer-Backend": result.backend,
        "X-Faces-Blurred": str(result.faces),
        "X-Plates-Blurred": str(result.plates),
        "X-Image-Width": str(decoded.width),
        "X-Image-Height": str(decoded.height),
        # KVKK: anonimleştirilmiş görsel ara önbelleklerde tutulmamalı.
        "Cache-Control": "no-store",
    }
    if request_id:
        headers["X-Request-ID"] = request_id

    return Response(content=buffer.getvalue(), media_type="image/png", headers=headers)
