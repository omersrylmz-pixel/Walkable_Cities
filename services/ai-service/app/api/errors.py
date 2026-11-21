"""RFC 7807 `application/problem+json` hata yanıtları.

API servisiyle (`services/api`) aynı sözleşmeyi kullanır; istemciler tek bir
hata ayrıştırma yoluna sahip olur.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.services.imaging import (
    ImageDecodeError,
    ImageTooLargeError,
    UnsupportedImageError,
)

logger = logging.getLogger(__name__)

PROBLEM_BASE = "https://walkable-cities.example/problems"


def problem_response(
    *,
    status: int,
    title: str,
    detail: str,
    slug: str,
    request: Request | None = None,
    extra: dict[str, Any] | None = None,
) -> JSONResponse:
    body: dict[str, Any] = {
        "type": f"{PROBLEM_BASE}/{slug}",
        "title": title,
        "status": status,
        "detail": detail,
    }

    if request is not None:
        body["instance"] = request.url.path

    if extra:
        body.update(extra)

    return JSONResponse(
        status_code=status,
        content=body,
        media_type="application/problem+json",
    )


async def http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else "İstek işlenemedi"
    return problem_response(
        status=exc.status_code,
        title=_title_for(exc.status_code),
        detail=detail,
        slug=_slug_for(exc.status_code),
        request=request,
    )


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    errors = [
        {
            "field": ".".join(str(part) for part in error.get("loc", ()) if part != "body"),
            "message": error.get("msg", "Geçersiz değer"),
        }
        for error in exc.errors()
    ]

    return problem_response(
        status=422,
        title="İstek doğrulanamadı",
        detail="Gönderilen alanlardan biri veya birkaçı geçersiz.",
        slug="validation-error",
        request=request,
        extra={"errors": errors},
    )


async def image_decode_handler(request: Request, exc: ImageDecodeError) -> JSONResponse:
    if isinstance(exc, ImageTooLargeError):
        return problem_response(
            status=413,
            title="Görsel çok büyük",
            detail=str(exc),
            slug="payload-too-large",
            request=request,
        )

    if isinstance(exc, UnsupportedImageError):
        return problem_response(
            status=415,
            title="Desteklenmeyen medya türü",
            detail=str(exc),
            slug="unsupported-media-type",
            request=request,
        )

    return problem_response(
        status=422,
        title="Görsel çözülemedi",
        detail=str(exc),
        slug="invalid-image",
        request=request,
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Beklenmeyen hata: %s %s", request.method, request.url.path)
    return problem_response(
        status=500,
        title="Sunucu hatası",
        detail="Analiz sırasında beklenmeyen bir hata oluştu.",
        slug="internal-error",
        request=request,
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(ImageDecodeError, image_decode_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)


def _title_for(status: int) -> str:
    return {
        400: "Geçersiz istek",
        401: "Yetkisiz",
        403: "Yasak",
        404: "Bulunamadı",
        405: "Yöntem desteklenmiyor",
        413: "Yük çok büyük",
        415: "Desteklenmeyen medya türü",
        422: "İşlenemeyen varlık",
        429: "Çok fazla istek",
        503: "Servis hazır değil",
    }.get(status, "İstek hatası")


def _slug_for(status: int) -> str:
    return {
        400: "bad-request",
        401: "unauthorized",
        403: "forbidden",
        404: "not-found",
        405: "method-not-allowed",
        413: "payload-too-large",
        415: "unsupported-media-type",
        422: "validation-error",
        429: "rate-limited",
        503: "service-unavailable",
    }.get(status, "http-error")
