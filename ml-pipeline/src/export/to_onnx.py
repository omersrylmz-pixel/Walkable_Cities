"""Eğitilmiş Ultralytics modelini ONNX'e aktarma ve doğrulama yardımcısı.

Ultralytics ve onnxruntime yalnızca bu komut çalıştırıldığında gerekir:

    python -m src.export.to_onnx \
        --weights runs/detect/train/weights/best.pt \
        --output ../services/ai-service/models/detector.onnx \
        --imgsz 640 --opset 17 --dynamic --verify

Not: AI servisi ONNX girişini `[1, 3, S, S]` float32 RGB (0-1) bekler.
YOLO export'u varsayılan olarak bu sözleşmeye uyar; DETR için
`DETECTOR_OUTPUT_FORMAT=detr` ayarlanmalıdır.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path
from typing import Any


def export_yolo(
    weights: str | Path,
    output: str | Path,
    *,
    imgsz: int = 640,
    opset: int = 17,
    dynamic: bool = True,
    half: bool = False,
    simplify: bool = True,
) -> Path:
    """Ultralytics YOLO modelini ONNX'e aktarır ve `output` yoluna kopyalar."""
    try:
        from ultralytics import YOLO
    except ImportError as exc:  # pragma: no cover - isteğe bağlı bağımlılık
        raise RuntimeError(
            "ultralytics kurulu değil. `pip install ultralytics` çalıştırın."
        ) from exc

    weights_path = Path(weights)
    output_path = Path(output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    model = YOLO(str(weights_path))
    exported = model.export(
        format="onnx",
        imgsz=imgsz,
        opset=opset,
        dynamic=dynamic,
        half=half,
        simplify=simplify,
    )

    exported_path = Path(str(exported))
    if exported_path.resolve() != output_path.resolve():
        shutil.copy2(exported_path, output_path)

    return output_path


def verify_onnx(
    path: str | Path,
    *,
    input_size: int = 640,
    run: bool = True,
) -> dict[str, Any]:
    """ONNX modelinin giriş/çıkış sözleşmesini doğrular."""
    try:
        import numpy as np
        import onnxruntime as ort
    except ImportError as exc:  # pragma: no cover - isteğe bağlı bağımlılık
        raise RuntimeError(
            "onnxruntime ve numpy kurulu değil. `pip install onnxruntime numpy` çalıştırın."
        ) from exc

    model_path = Path(path)
    if not model_path.is_file():
        raise FileNotFoundError(f"ONNX dosyası bulunamadı: {model_path}")

    session = ort.InferenceSession(
        str(model_path), providers=["CPUExecutionProvider"]
    )
    inputs = [
        {
            "name": item.name,
            "shape": item.shape,
            "type": item.type,
        }
        for item in session.get_inputs()
    ]
    outputs = [
        {
            "name": item.name,
            "shape": item.shape,
            "type": item.type,
        }
        for item in session.get_outputs()
    ]

    latency_ms: float | None = None
    if run:
        import time

        input_meta = session.get_inputs()[0]
        shape = [
            dimension if isinstance(dimension, int) else input_size
            for dimension in input_meta.shape
        ]
        tensor = np.zeros(shape, dtype=np.float32)

        start = time.perf_counter()
        session.run(None, {input_meta.name: tensor})
        latency_ms = round((time.perf_counter() - start) * 1000, 2)

    return {
        "path": str(model_path),
        "sizeBytes": model_path.stat().st_size,
        "inputs": inputs,
        "outputs": outputs,
        "latencyMs": latency_ms,
    }


def main(argv: list[str] | None = None) -> int:
    import json

    parser = argparse.ArgumentParser(description="YOLO -> ONNX export")
    parser.add_argument("--weights", required=True, help=".pt ağırlık dosyası")
    parser.add_argument("--output", required=True, help="Hedef .onnx yolu")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--opset", type=int, default=17)
    parser.add_argument("--dynamic", action="store_true")
    parser.add_argument("--half", action="store_true")
    parser.add_argument("--no-simplify", action="store_true")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--no-run", action="store_true")
    args = parser.parse_args(argv)

    target = export_yolo(
        args.weights,
        args.output,
        imgsz=args.imgsz,
        opset=args.opset,
        dynamic=args.dynamic,
        half=args.half,
        simplify=not args.no_simplify,
    )

    payload: dict[str, Any] = {"exported": str(target)}
    if args.verify:
        payload["verification"] = verify_onnx(
            target,
            input_size=args.imgsz,
            run=not args.no_run,
        )

    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
