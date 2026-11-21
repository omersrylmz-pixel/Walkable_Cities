"""COCO detection JSON -> YOLO txt dönüştürücüsü.

Kullanım:
    python -m src.datasets.coco_to_yolo \
        --annotations data/raw/annotations.json \
        --images data/raw/images \
        --output data/processed/detector \
        --copy-images

Çıktı:
    output/
    ├── images/                 # --copy-images verilirse
    ├── labels/*.txt            # class_id cx cy w h (normalize)
    ├── classes.txt
    ├── data.yaml
    └── conversion-report.json
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


@dataclass
class ConversionReport:
    output_dir: str
    images: int = 0
    annotations: int = 0
    converted: int = 0
    skipped: int = 0
    empty_images: int = 0
    missing_images: int = 0
    class_names: list[str] = field(default_factory=list)
    class_distribution: dict[str, int] = field(default_factory=dict)
    skipped_reasons: dict[str, int] = field(default_factory=dict)

    def skip(self, reason: str) -> None:
        self.skipped += 1
        self.skipped_reasons[reason] = self.skipped_reasons.get(reason, 0) + 1


def convert_coco(
    coco: dict[str, Any],
    *,
    images_dir: str | Path,
    output_dir: str | Path,
    class_map: dict[int | str, str] | None = None,
    copy_images: bool = False,
    include_empty: bool = True,
) -> ConversionReport:
    """COCO sözlüğünü YOLO etiket dosyalarına çevirir.

    Args:
        coco: `images`, `annotations`, `categories` anahtarlarını içeren COCO JSON.
        images_dir: Görsellerin kaynak dizini.
        output_dir: Etiketlerin ve `data.yaml` dosyasının yazılacağı dizin.
        class_map: `{category_id: sınıf_adı}` eşlemesi. Verilmezse COCO
            kategorileri id sırasına göre kullanılır.
        copy_images: Görselleri `output/images` altına kopyala.
        include_empty: Etiketi olmayan görseller için boş `.txt` üret.
    """
    images_dir = Path(images_dir)
    output_dir = Path(output_dir)
    labels_dir = output_dir / "labels"
    labels_dir.mkdir(parents=True, exist_ok=True)

    images = _require_list(coco, "images")
    annotations = _require_list(coco, "annotations")
    categories = _require_list(coco, "categories")

    category_to_index, class_names = build_class_map(categories, class_map)

    image_by_id: dict[int, dict[str, Any]] = {}
    for image in images:
        image_id = int(image["id"])
        width = float(image.get("width") or 0)
        height = float(image.get("height") or 0)
        if width <= 0 or height <= 0:
            continue
        image_by_id[image_id] = image

    annotations_by_image: dict[int, list[dict[str, Any]]] = {
        image_id: [] for image_id in image_by_id
    }
    orphan_annotations: list[dict[str, Any]] = []
    for annotation in annotations:
        image_id = int(annotation.get("image_id", -1))
        if image_id in annotations_by_image:
            annotations_by_image[image_id].append(annotation)
        else:
            orphan_annotations.append(annotation)

    report = ConversionReport(
        output_dir=str(output_dir),
        images=len(image_by_id),
        annotations=len(annotations),
        class_names=class_names,
    )

    for _ in orphan_annotations:
        report.skip("unknown_image")

    distribution: Counter[str] = Counter()

    output_images_dir = output_dir / "images"
    if copy_images:
        output_images_dir.mkdir(parents=True, exist_ok=True)

    used_stems: set[str] = set()

    for image_id in sorted(image_by_id):
        image = image_by_id[image_id]
        width = float(image["width"])
        height = float(image["height"])
        stem = _unique_stem(_safe_stem(image.get("file_name"), image_id), used_stems)
        lines: list[str] = []

        for annotation in annotations_by_image[image_id]:
            if int(annotation.get("iscrowd", 0)) == 1:
                report.skip("crowd_annotation")
                continue

            category_id = int(annotation.get("category_id", -1))
            class_index = category_to_index.get(category_id)
            if class_index is None:
                report.skip("unknown_category")
                continue

            bbox = annotation.get("bbox") or []
            if len(bbox) != 4:
                report.skip("invalid_bbox")
                continue

            yolo_box = _bbox_to_yolo(bbox, width, height)
            if yolo_box is None:
                report.skip("degenerate_bbox")
                continue

            cx, cy, bw, bh = yolo_box
            lines.append(
                f"{class_index} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}"
            )
            distribution[class_names[class_index]] += 1
            report.converted += 1

        label_path = labels_dir / f"{stem}.txt"
        if lines or include_empty:
            label_path.write_text(
                "\n".join(lines) + ("\n" if lines else ""), encoding="utf-8"
            )

        if not lines:
            report.empty_images += 1

        if copy_images:
            source = images_dir / str(image.get("file_name", ""))
            if source.is_file():
                shutil.copy2(source, output_images_dir / f"{stem}{source.suffix.lower()}")
            else:
                report.missing_images += 1

    images_reference = (
        output_images_dir if copy_images else images_dir.resolve()
    )

    (output_dir / "classes.txt").write_text(
        "\n".join(class_names) + "\n", encoding="utf-8"
    )
    _write_data_yaml(output_dir, images_reference, class_names)
    report.class_distribution = dict(sorted(distribution.items()))

    (output_dir / "conversion-report.json").write_text(
        json.dumps(asdict(report), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    return report


def build_class_map(
    categories: Iterable[dict[str, Any]],
    class_map: dict[int | str, str] | None = None,
) -> tuple[dict[int, int], list[str]]:
    """COCO kategori id -> bitişik YOLO sınıf indeksi eşlemesi üretir."""
    if class_map:
        ordered = sorted((int(key), str(value)) for key, value in class_map.items())
        category_ids = [category_id for category_id, _ in ordered]
        class_names = _deduplicate([name for _, name in ordered])
    else:
        ordered_categories = sorted(
            (int(category["id"]), str(category.get("name") or category["id"]))
            for category in categories
        )
        category_ids = [category_id for category_id, _ in ordered_categories]
        class_names = _deduplicate([name for _, name in ordered_categories])

    return {category_id: index for index, category_id in enumerate(category_ids)}, class_names


def _bbox_to_yolo(
    bbox: Iterable[float], width: float, height: float
) -> tuple[float, float, float, float] | None:
    x, y, box_width, box_height = (float(value) for value in bbox)

    x1 = max(0.0, min(x, width))
    y1 = max(0.0, min(y, height))
    x2 = max(0.0, min(x + box_width, width))
    y2 = max(0.0, min(y + box_height, height))

    clipped_width = x2 - x1
    clipped_height = y2 - y1
    if clipped_width < 1.0 or clipped_height < 1.0:
        return None

    cx = (x1 + x2) / 2.0 / width
    cy = (y1 + y2) / 2.0 / height
    norm_width = clipped_width / width
    norm_height = clipped_height / height

    return (
        _clamp(cx),
        _clamp(cy),
        _clamp(norm_width),
        _clamp(norm_height),
    )


def _write_data_yaml(
    output_dir: Path, images_reference: Path, class_names: list[str]
) -> None:
    lines = [
        "# otomatik üretildi: src.datasets.coco_to_yolo",
        f"path: {json.dumps(str(output_dir.resolve()))}",
        f"train: {json.dumps(str(images_reference))}",
        f"val: {json.dumps(str(images_reference))}",
        "names:",
    ]
    lines.extend(f"  {index}: {json.dumps(name)}" for index, name in enumerate(class_names))
    (output_dir / "data.yaml").write_text("\n".join(lines) + "\n", encoding="utf-8")


def _safe_stem(file_name: Any, image_id: int) -> str:
    raw = Path(str(file_name or "")).stem or f"image_{image_id}"
    cleaned = re.sub(r'[<>:"/\\|?*\s]+', "_", raw).strip("._")
    return cleaned or f"image_{image_id}"


def _unique_stem(stem: str, used: set[str]) -> str:
    candidate = stem
    suffix = 1
    while candidate in used:
        candidate = f"{stem}_{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate


def _deduplicate(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        name = value
        counter = 1
        while name in seen:
            counter += 1
            name = f"{value}_{counter}"
        seen.add(name)
        result.append(name)
    return result


def _require_list(payload: dict[str, Any], key: str) -> list[dict[str, Any]]:
    value = payload.get(key)
    if not isinstance(value, list):
        raise ValueError(f"COCO dosyasında '{key}' listesi yok")
    return [item for item in value if isinstance(item, dict)]


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def load_class_map(path: str | Path | None) -> dict[int, str] | None:
    if path is None:
        return None

    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Sınıf eşlemesi {category_id: sınıf_adı} biçiminde olmalı")

    return {int(key): str(value) for key, value in payload.items()}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="COCO detection -> YOLO dönüştürücü")
    parser.add_argument("--annotations", required=True, help="COCO JSON yolu")
    parser.add_argument("--images", required=True, help="Görsel kaynak dizini")
    parser.add_argument("--output", required=True, help="Çıktı dizini")
    parser.add_argument(
        "--class-map",
        help="JSON: {\"1\": \"vehicle_on_walkway\", ...} (opsiyonel)",
    )
    parser.add_argument("--copy-images", action="store_true")
    parser.add_argument("--skip-empty", action="store_true")
    args = parser.parse_args(argv)

    coco = json.loads(Path(args.annotations).read_text(encoding="utf-8"))
    report = convert_coco(
        coco,
        images_dir=args.images,
        output_dir=args.output,
        class_map=load_class_map(args.class_map),
        copy_images=args.copy_images,
        include_empty=not args.skip_empty,
    )

    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
