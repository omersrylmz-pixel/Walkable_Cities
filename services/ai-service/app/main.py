"""Yaya Alanı İhlal Tespiti — FastAPI giriş noktası.

Faz 2 kapsamı:
  - `POST /v1/analyze`  : görsel -> tespitler, segmentasyon, overlap, skor, karar
  - `GET /v1/models`    : yüklü model sürümleri ve çıkarım ayarları
  - ONNX Runtime oturum yönetimi (YOLO26 / RF-DETR + segmentasyon)
  - Model warm-up, sürüm raporu ve gecikme ölçümü

Model ağırlıkları yoksa geliştirme/CI için deterministik yedek hat devreye
girer (`backend: "heuristic"`); `ALLOW_HEURISTIC_FALLBACK=false` ile kapatılır.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api import analyze_router, health_router, models_router
from app.api.errors import problem_response, register_exception_handlers
from app.core.config import Settings, get_settings
from app.services.analyzer import Analyzer
from app.services.onnx_models import ModelRegistry

logger = logging.getLogger(__name__)

#: Multipart başlık/sınır ek yükü için tolerans (bayt).
MULTIPART_OVERHEAD_BYTES = 1024 * 1024


def create_app(settings: Settings | None = None) -> FastAPI:
    """Uygulama fabrikası.

    Testler özel `Settings` ile izole bir uygulama oluşturabilir; üretimde
    modül seviyesindeki `app` ortam değişkenlerinden yüklenir.
    """
    resolved = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        registry = ModelRegistry(resolved)
        logger.info("Model kaydı yükleniyor (dizin: %s)", resolved.model_dir)
        registry.load()

        if resolved.warmup_on_startup:
            registry.warmup()

        app.state.registry = registry
        app.state.analyzer = Analyzer(registry, resolved)
        logger.info(
            "AI servisi hazır: backend=%s ready=%s model=%s",
            registry.backend,
            registry.ready,
            registry.model_version,
        )

        if not registry.ready:
            logger.error(
                "Model yüklenemedi ve yedek hat kapalı; /health/ready 503 dönecek."
            )

        try:
            yield
        finally:
            app.state.analyzer = None
            app.state.registry = None

    app = FastAPI(
        title="Yaya Alanı İhlal Tespiti — AI Servisi",
        description=(
            "YOLO26 / RF-DETR nesne tespiti ve kaldırım/yaya geçidi segmentasyonu "
            "ile ihlal tespiti, overlap (IoU) hesabı ve güven skoru üretimi."
        ),
        version="0.2.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )
    app.state.settings = resolved

    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolved.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)

    @app.middleware("http")
    async def reject_oversized_uploads(request: Request, call_next):  # type: ignore[no-untyped-def]
        """Multipart ayrıştırmasından önce `Content-Length` ile erken ret."""
        if request.url.path == "/v1/analyze":
            content_length = request.headers.get("content-length")

            if content_length:
                try:
                    declared = int(content_length)
                except ValueError:
                    declared = 0

                if declared > resolved.max_upload_bytes + MULTIPART_OVERHEAD_BYTES:
                    return problem_response(
                        status=413,
                        title="Görsel çok büyük",
                        detail=(
                            f"İstek gövdesi {resolved.max_upload_mb} MB görsel "
                            "sınırını aşıyor."
                        ),
                        slug="payload-too-large",
                        request=request,
                    )

        return await call_next(request)

    app.include_router(health_router)
    app.include_router(analyze_router)
    app.include_router(models_router)

    @app.get("/", tags=["meta"])
    async def root(request: Request) -> dict[str, str]:
        registry: ModelRegistry | None = getattr(request.app.state, "registry", None)
        return {
            "service": resolved.app_name,
            "version": app.version,
            "backend": registry.backend if registry else "starting",
            "docs": "/docs",
            "health": "/health",
            "ready": "/health/ready",
            "analyze": "/v1/analyze",
            "models": "/v1/models",
        }

    return app


app = create_app()
