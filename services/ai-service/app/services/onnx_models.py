"""ONNX Runtime oturum yönetimi ve model kaydı."""

from __future__ import annotations

import hashlib
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from app.core.config import Settings
from app.services.classes import load_class_names

logger = logging.getLogger(__name__)

try:  # pragma: no cover - ortamda onnxruntime yoksa yedek hat devreye girer
    import onnxruntime as ort
except ImportError:  # pragma: no cover
    ort = None  # type: ignore[assignment]


@dataclass
class ModelState:
    role: str
    name: str
    version: str
    path: str
    input_size: int
    loaded: bool = False
    error: str | None = None


@dataclass
class LoadedModel:
    state: ModelState
    session: Any = field(repr=False)

    @property
    def input_name(self) -> str:
        return self.session.get_inputs()[0].name

    def run(self, tensor: np.ndarray) -> list[np.ndarray]:
        return self.session.run(None, {self.input_name: tensor})


class ModelRegistry:
    """Model dosyalarını bir kez yükler, warm-up yapar ve sürüm bilgisi sunar."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.class_names = load_class_names(settings.classes_path, settings.model_classes)
        self.detector: LoadedModel | None = None
        self.segmenter: LoadedModel | None = None
        self.states: list[ModelState] = []
        self.warmup_ms: float | None = None
        self.loaded_at: float | None = None

    def load(self) -> None:
        self.detector = self._load(
            role="detector",
            path=self.settings.detector_path,
            input_size=self.settings.detector_input_size,
        )
        self.segmenter = self._load(
            role="segmenter",
            path=self.settings.segmenter_path,
            input_size=self.settings.segmenter_input_size,
        )
        self.loaded_at = time.time()

    def _load(self, *, role: str, path: Path, input_size: int) -> LoadedModel | None:
        state = ModelState(
            role=role,
            name=path.stem,
            version="-",
            path=str(path),
            input_size=input_size,
        )
        self.states.append(state)

        if ort is None:
            state.error = "onnxruntime yüklü değil"
            logger.warning("[%s] %s", role, state.error)
            return None

        if not path.exists():
            state.error = "model dosyası bulunamadı"
            logger.warning("[%s] %s: %s", role, state.error, path)
            return None

        try:
            options = ort.SessionOptions()
            options.intra_op_num_threads = self.settings.onnx_intra_op_threads
            options.inter_op_num_threads = 1
            options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            options.log_severity_level = 3

            session = ort.InferenceSession(
                str(path),
                sess_options=options,
                providers=["CPUExecutionProvider"],
            )
        except Exception as exc:  # noqa: BLE001 - oturum hataları raporlanmalı
            state.error = f"oturum açılamadı: {exc}"
            logger.exception("[%s] ONNX oturumu açılamadı", role)
            return None

        state.version = _file_digest(path)[:12]
        state.loaded = True
        logger.info("[%s] model yüklendi: %s (%s)", role, path.name, state.version)
        return LoadedModel(state=state, session=session)

    def warmup(self) -> None:
        """İlk isteğin gecikmesini önlemek için sıfır tensörle bir çalıştırma yapar."""
        start = time.perf_counter()

        try:
            if self.detector:
                size = self.settings.detector_input_size
                self.detector.run(np.zeros((1, 3, size, size), dtype=np.float32))

            if self.segmenter:
                size = self.settings.segmenter_input_size
                self.segmenter.run(np.zeros((1, 3, size, size), dtype=np.float32))
        except Exception:  # noqa: BLE001 - warm-up başarısızlığı servisi durdurmamalı
            logger.exception("Model warm-up sırasında hata")
        finally:
            self.warmup_ms = round((time.perf_counter() - start) * 1000, 2)
            logger.info("Model warm-up tamamlandı: %.2f ms", self.warmup_ms)

    @property
    def backend(self) -> str:
        return "onnx" if self.detector and self.segmenter else "heuristic"

    @property
    def ready(self) -> bool:
        return self.backend == "onnx" or self.settings.allow_heuristic_fallback

    @property
    def model_version(self) -> str:
        if self.detector and self.segmenter:
            return (
                f"{self.detector.state.name}@{self.detector.state.version}"
                f"+{self.segmenter.state.name}@{self.segmenter.state.version}"
            )
        return "heuristic-baseline-v1"

    def describe(self) -> list[dict[str, Any]]:
        return [
            {
                "role": state.role,
                "name": state.name,
                "version": state.version,
                "loaded": state.loaded,
                "path": state.path,
                "input_size": state.input_size,
                "error": state.error,
            }
            for state in self.states
        ]


def _file_digest(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()
