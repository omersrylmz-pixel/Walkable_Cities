"""`/v1/analyze` ve model bilgisi için Pydantic şemaları.

JSON alanları camelCase'dir; Python tarafında snake_case kullanılır.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

DecisionOutcome = Literal["auto_accept", "manual_review", "auto_reject"]
Backend = Literal["onnx", "heuristic"]
ModelRole = Literal["detector", "segmenter"]


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Thresholds(ApiModel):
    auto_accept: float
    manual_review: float


class BoundingBox(ApiModel):
    x: float = Field(ge=0, description="Sol üst köşe X (analiz edilen görsel pikseli)")
    y: float = Field(ge=0, description="Sol üst köşe Y (analiz edilen görsel pikseli)")
    width: float = Field(ge=0)
    height: float = Field(ge=0)


class DetectionOut(ApiModel):
    label: str
    class_id: int
    confidence: float = Field(ge=0, le=1)
    box: BoundingBox
    overlap_ratio: float = Field(ge=0, le=1, description="Kutu alanının yürünebilir alanla örtüşmesi")
    severity: int = Field(ge=1, le=5)
    violation_type: str


class MaskRle(ApiModel):
    """Satır-öncelikli, 0 ile başlayan çalışma uzunluğu kodlaması."""

    encoding: Literal["rle_counts"] = "rle_counts"
    size: tuple[int, int] = Field(description="[yükseklik, genişlik]")
    counts: list[int]


class SegmentationOut(ApiModel):
    walkable_area_ratio: float = Field(ge=0, le=1)
    sidewalk_ratio: float = Field(ge=0, le=1)
    crosswalk_ratio: float = Field(ge=0, le=1)
    obstacle_ratio: float = Field(ge=0, le=1)
    mask: MaskRle | None = None


class ImageInfo(ApiModel):
    width: int = Field(
        description="Analiz edilen görsel genişliği; kutu ve maske koordinatları bu uzaydadır"
    )
    height: int = Field(description="Analiz edilen görsel yüksekliği")
    original_width: int = Field(description="Yükleme sonrası (EXIF düzeltmeli) orijinal genişlik")
    original_height: int = Field(description="Yükleme sonrası (EXIF düzeltmeli) orijinal yükseklik")
    mime_type: str
    sha256: str
    byte_size: int


class ModelVersion(ApiModel):
    role: ModelRole
    name: str
    version: str
    loaded: bool
    path: str
    input_size: int
    error: str | None = None


class MetricsOut(ApiModel):
    overlap_ratio: float = Field(ge=0, le=1)
    obstruction_ratio: float = Field(ge=0, le=1)
    top_confidence: float = Field(ge=0, le=1)
    detection_count: int


class ScoreOut(ApiModel):
    raw: float = Field(ge=0, le=1)
    calibrated: float = Field(ge=0, le=1)
    temperature: float


class DecisionOut(ApiModel):
    outcome: DecisionOutcome
    status: Literal["auto_approved", "pending_review", "auto_rejected"]
    reason: str
    thresholds: Thresholds


class LatencyOut(ApiModel):
    preprocess_ms: float
    detector_ms: float
    segmenter_ms: float
    postprocess_ms: float
    total_ms: float


class AnalyzeResponse(ApiModel):
    request_id: str
    backend: Backend
    deterministic: bool = True
    models: list[ModelVersion]
    image: ImageInfo
    detections: list[DetectionOut]
    segmentation: SegmentationOut
    metrics: MetricsOut
    score: ScoreOut
    decision: DecisionOut
    latency: LatencyOut
    model_version: str
    analyzed_at: datetime


class ModelsResponse(ApiModel):
    backend: Backend
    ready: bool
    models: list[ModelVersion]
    decision_thresholds: Thresholds
    score_temperature: float
    class_schema: list[str]
    analysis_max_dimension: int
