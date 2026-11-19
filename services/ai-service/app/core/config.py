"""Servis yapılandırması.

Tüm değerler ortam değişkenleri veya `.env` dosyasından okunur.
Karar eşikleri, veritabanındaki `system_setting.decision.thresholds` ile
aynı varsayılanlara sahiptir (bkz. infra/init.sql).
"""

from functools import lru_cache

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

    # Karar mekanizması eşikleri
    auto_accept_threshold: float = 0.85
    manual_review_threshold: float = 0.60

    # Görüntü işleme sınırları
    max_upload_mb: int = 12
    max_image_dimension: int = 4096

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


@lru_cache
def get_settings() -> Settings:
    """Ayarları tek seferlik yükler (FastAPI dependency olarak kullanılabilir)."""
    return Settings()
