"""Yaya Alanı İhlal Tespiti — FastAPI giriş noktası.

Faz 0 kapsamı: uygulama iskeleti, sağlık uçları ve yapılandırma.
Faz 2'de eklenecekler:
  - `POST /v1/analyze`  : görsel + metadata -> tespitler, segmentasyon, overlap
  - ONNX Runtime oturum yönetimi (YOLO26, RF-DETR, segmentasyon)
  - Model ısınma (warm-up) ve sürüm raporlama
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health_router
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(
    title="Yaya Alanı İhlal Tespiti — AI Servisi",
    description=(
        "YOLO26 / RF-DETR nesne tespiti ve kaldırım/yaya geçidi segmentasyonu "
        "ile ihlal tespiti, overlap (IoU) hesabı ve güven skoru üretimi."
    ),
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)


@app.get("/", tags=["meta"])
async def root() -> dict[str, str]:
    return {
        "service": settings.app_name,
        "version": app.version,
        "docs": "/docs",
        "health": "/health",
    }
