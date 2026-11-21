"""Servis yapılandırması.

Tüm değerler ortam değişkenleri veya `.env` dosyasından okunur.
Karar eşikleri, veritabanındaki `system_setting.decision.thresholds` ile
aynı varsayılanlara sahiptir (bkz. infra/init.sql).
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "yaya-ai-service"
    environment: str = "development"
    log_level: str = "info"

    # ONNX ağırlıklarının bulunacağı dizin (git'e girmez)
    model_dir: str = "./models"
    detector_model_file: str = "detector.onnx"
    segmenter_model_file: str = "segmenter.onnx"

    # Model sözleşmesi
    detector_output_format: Literal["yolo", "detr"] = "yolo"
    detector_input_size: int = 640
    segmenter_input_size: int = 512
    detector_confidence_threshold: float = 0.25
    detector_iou_threshold: float = 0.45
    max_detections: int = 50

    # Sınıf adları: boşsa `model_dir/classes.json`, o da yoksa yerleşik şema.
    model_classes: str = ""

    # Çıkarım / ön işleme sınırları
    analysis_max_dimension: int = 1024
    max_upload_mb: int = 12
    max_image_dimension: int = 4096
    onnx_intra_op_threads: int = 2

    # Skor kalibrasyonu (temperature scaling; 1.0 = kalibrasyon yok)
    score_temperature: float = 1.0

    # Ağırlıklar yoksa geliştirme/CI için deterministik yedek hat
    allow_heuristic_fallback: bool = True
    warmup_on_startup: bool = True

    # Karar mekanizması eşikleri
    auto_accept_threshold: float = 0.85
    manual_review_threshold: float = 0.60

    cors_origins: str = "http://localhost:3002,http://localhost:3001"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def thresholds(self) -> dict[str, float]:
        return {
            "auto_accept": self.auto_accept_threshold,
            "manual_review": self.manual_review_threshold,
        }

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def detector_path(self) -> Path:
        return Path(self.model_dir) / self.detector_model_file

    @property
    def segmenter_path(self) -> Path:
        return Path(self.model_dir) / self.segmenter_model_file

    @property
    def classes_path(self) -> Path:
        return Path(self.model_dir) / "classes.json"


@lru_cache
def get_settings() -> Settings:
    """Ayarları tek seferlik yükler (FastAPI dependency olarak kullanılabilir)."""
    return Settings()
