"""YOLO etiket doğrulama ve veri seti kalite raporu.

Kullanım:
    python -m src.datasets.validate_labels \
        --labels data/processed/detector/labels \
        --images data/processed/detector/images \
        --classes data/processed/detector/classes.txt \
        --report data/processed/detector/validation-report.json

Kontrol edilenler:
  - Satır biçimi ve sayısal alanlar
  - Sınıf indeksi aralığı
  - Normalize koordinat sınırları ve kutu taşmaları
  - Aynı görselde neredeyse aynı kutular (mükerrer etiket)
  - Görseli/etiketi eksik dosyalar
  - Sınıf dağılımı ve dengesizlik oranı
"""

from __future__ import annotations

import argparse
import json
import math
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable, Literal

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
COORD_EPSILON = 1e-6

Severity = Literal["error", "warning", "info"]


@dataclass
class LabelIssue:
    severity: Severity
    code: str
    message: str
    file: str | None = None
    line: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ValidationReport:
    labels_dir: str
    images_dir: str | None
    class_names: list[str] = field(default_factory=list)
    label_files: int = 0
    images: int = 0
    boxes: int = 0
    empty_label_files: int = 0
    duplicate_boxes: int = 0
    class_distribution: dict[str, int] = field(default_factory=dict)
    imbalance_ratio: float | None = None
    issues: list[LabelIssue] = field(default_factory=list)

    @property
    def error_count(self) -> int:
        return sum(1 for issue in self.issues if issue.severity == "error")

    @property
    def warning_count(self) -> int:
        return sum(1 for issue in self.issues if issue.severity == "warning")

    @property
    def ok(self) -> bool:
        return self.error_count == 0

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["issues"] = [issue.to_dict() for issue in self.issues]
        payload["error_count"] = self.error_count
        payload["warning_count"] = self.warning_count
        payload["ok"] = self.ok
        return payload


def validate_dataset(
    *,
    labels_dir: str | Path,
    images_dir: str | Path | None = None,
    class_names: Iterable[str] | None = None,
    duplicate_iou: float = 0.95,
) -> ValidationReport:
    labels_path = Path(labels_dir)
    images_path = Path(images_dir) if images_dir else None

    if not labels_path.is_dir():
        raise FileNotFoundError(f"Etiket dizini bulunamadı: {labels_path}")

    names = list(class_names or [])
    class_count = len(names) if names else None

    report = ValidationReport(
        labels_dir=str(labels_path),
        images_dir=str(images_path) if images_path else None,
        class_names=names,
    )

    image_stems = _collect_image_stems(images_path)
    report.images = len(image_stems)

    label_files = sorted(labels_path.glob("*.txt"))
    report.label_files = len(label_files)
    label_stems = {path.stem for path in label_files}

    distribution: Counter[int] = Counter()

    for label_file in label_files:
        boxes_in_file: list[tuple[int, float, float, float, float]] = []
        lines = label_file.read_text(encoding="utf-8").splitlines()
        non_empty = 0

        for line_number, raw_line in enumerate(lines, start=1):
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue

            non_empty += 1
            parsed = _parse_line(
                line,
                file=label_file.name,
                line_number=line_number,
                class_count=class_count,
                report=report,
            )
            if parsed is None:
                continue

            class_id, cx, cy, width, height = parsed

            if not all(math.isfinite(value) for value in (cx, cy, width, height)):
                report.issues.append(
                    LabelIssue(
                        "error",
                        "non_finite_coordinate",
                        "Koordinatlarda NaN/Inf var.",
                        label_file.name,
                        line_number,
                    )
                )
                continue

            if not (0.0 <= cx <= 1.0 and 0.0 <= cy <= 1.0):
                report.issues.append(
                    LabelIssue(
                        "error",
                        "center_out_of_range",
                        f"Merkez koordinatı [0,1] dışında: ({cx}, {cy}).",
                        label_file.name,
                        line_number,
                    )
                )
                continue

            if not (0.0 < width <= 1.0 and 0.0 < height <= 1.0):
                report.issues.append(
                    LabelIssue(
                        "error",
                        "invalid_size",
                        f"Genişlik/yükseklik (0,1] aralığında olmalı: ({width}, {height}).",
                        label_file.name,
                        line_number,
                    )
                )
                continue

            if _box_exceeds_bounds(cx, cy, width, height):
                report.issues.append(
                    LabelIssue(
                        "warning",
                        "box_out_of_bounds",
                        "Kutu görsel sınırlarının dışına taşıyor; kırpılması önerilir.",
                        label_file.name,
                        line_number,
                    )
                )

            for previous in boxes_in_file:
                if _duplicate(previous, (class_id, cx, cy, width, height), duplicate_iou):
                    report.duplicate_boxes += 1
                    report.issues.append(
                        LabelIssue(
                            "warning",
                            "duplicate_box",
                            f"Aynı sınıfta neredeyse aynı kutu (IoU > {duplicate_iou}).",
                            label_file.name,
                            line_number,
                        )
                    )
                    break

            boxes_in_file.append((class_id, cx, cy, width, height))
            distribution[class_id] += 1
            report.boxes += 1

        if non_empty == 0:
            report.empty_label_files += 1
            report.issues.append(
                LabelIssue(
                    "warning",
                    "empty_label_file",
                    "Etiket dosyası boş (negatif örnek).",
                    label_file.name,
                )
            )

    report.class_distribution = _distribution_payload(distribution, names)

    if class_count:
        missing = [names[index] for index in range(class_count) if distribution.get(index, 0) == 0]
        if missing:
            report.issues.append(
                LabelIssue(
                    "warning",
                    "missing_classes",
                    "Eğitim setinde hiç örneği olmayan sınıflar: " + ", ".join(missing),
                )
            )

        counts = [distribution.get(index, 0) for index in range(class_count)]
        present = [count for count in counts if count > 0]
        if len(present) >= 2:
            report.imbalance_ratio = round(max(present) / min(present), 2)
            if report.imbalance_ratio >= 10:
                report.issues.append(
                    LabelIssue(
                        "warning",
                        "class_imbalance",
                        f"Sınıf dengesizliği yüksek (max/min = {report.imbalance_ratio}).",
                    )
                )

    if images_path is not None:
        for stem in sorted(image_stems - label_stems):
            report.issues.append(
                LabelIssue(
                    "warning",
                    "missing_label",
                    "Görsel için etiket dosyası yok.",
                    f"{stem}{_suffix_for(stem, images_path)}",
                )
            )

        for stem in sorted(label_stems - image_stems):
            report.issues.append(
                LabelIssue(
                    "error",
                    "orphan_label",
                    "Etiket dosyasına karşılık gelen görsel yok.",
                    f"{stem}.txt",
                )
            )

    return report


def _parse_line(
    line: str,
    *,
    file: str,
    line_number: int,
    class_count: int | None,
    report: ValidationReport,
) -> tuple[int, float, float, float, float] | None:
    parts = line.split()

    if len(parts) != 5:
        report.issues.append(
            LabelIssue(
                "error",
                "invalid_field_count",
                f"5 alan bekleniyordu, {len(parts)} bulundu.",
                file,
                line_number,
            )
        )
        return None

    try:
        class_id = int(parts[0])
    except ValueError:
        report.issues.append(
            LabelIssue(
                "error",
                "invalid_class_id",
                f"Sınıf indeksi tam sayı değil: {parts[0]!r}.",
                file,
                line_number,
            )
        )
        return None

    if class_id < 0 or (class_count is not None and class_id >= class_count):
        report.issues.append(
            LabelIssue(
                "error",
                "class_out_of_range",
                f"Sınıf indeksi aralık dışında: {class_id}.",
                file,
                line_number,
            )
        )
        return None

    try:
        cx, cy, width, height = (float(value) for value in parts[1:])
    except ValueError:
        report.issues.append(
            LabelIssue(
                "error",
                "invalid_coordinate",
                "Koordinatlar sayısal değil.",
                file,
                line_number,
            )
        )
        return None

    return class_id, cx, cy, width, height


def _box_exceeds_bounds(cx: float, cy: float, width: float, height: float) -> bool:
    half_width = width / 2.0
    half_height = height / 2.0
    return (
        cx - half_width < -COORD_EPSILON
        or cy - half_height < -COORD_EPSILON
        or cx + half_width > 1.0 + COORD_EPSILON
        or cy + half_height > 1.0 + COORD_EPSILON
    )


def _duplicate(
    first: tuple[int, float, float, float, float],
    second: tuple[int, float, float, float, float],
    threshold: float,
) -> bool:
    first_class, first_cx, first_cy, first_width, first_height = first
    second_class, second_cx, second_cy, second_width, second_height = second

    if first_class != second_class:
        return False

    first_box = _to_xyxy(first_cx, first_cy, first_width, first_height)
    second_box = _to_xyxy(second_cx, second_cy, second_width, second_height)

    return _iou(first_box, second_box) > threshold


def _to_xyxy(cx: float, cy: float, width: float, height: float) -> tuple[float, float, float, float]:
    return (
        cx - width / 2.0,
        cy - height / 2.0,
        cx + width / 2.0,
        cy + height / 2.0,
    )


def _iou(first: tuple[float, float, float, float], second: tuple[float, float, float, float]) -> float:
    x1 = max(first[0], second[0])
    y1 = max(first[1], second[1])
    x2 = min(first[2], second[2])
    y2 = min(first[3], second[3])

    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    first_area = max(0.0, first[2] - first[0]) * max(0.0, first[3] - first[1])
    second_area = max(0.0, second[2] - second[0]) * max(0.0, second[3] - second[1])
    union = first_area + second_area - intersection

    return intersection / union if union > 0 else 0.0


def _distribution_payload(distribution: Counter[int], names: list[str]) -> dict[str, int]:
    if names:
        return {
            f"{index}:{name}": distribution.get(index, 0)
            for index, name in enumerate(names)
        }

    return {
        str(class_id): count for class_id, count in sorted(distribution.items())
    }


def _collect_image_stems(images_path: Path | None) -> set[str]:
    if images_path is None or not images_path.is_dir():
        return set()

    return {
        path.stem
        for path in images_path.rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
    }


def _suffix_for(stem: str, images_path: Path) -> str:
    for path in images_path.rglob(f"{stem}.*"):
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES:
            return path.suffix.lower()
    return ""


def load_class_names(path: str | Path | None) -> list[str]:
    if path is None:
        return []

    names = [
        line.strip()
        for line in Path(path).read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    return names


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="YOLO etiket doğrulama")
    parser.add_argument("--labels", required=True, help="Etiket dizini (*.txt)")
    parser.add_argument("--images", help="Görsel dizini (opsiyonel)")
    parser.add_argument("--classes", help="classes.txt yolu (opsiyonel)")
    parser.add_argument("--report", help="JSON rapor çıktı yolu")
    parser.add_argument("--duplicate-iou", type=float, default=0.95)
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Uyarıları da başarısız say",
    )
    args = parser.parse_args(argv)

    report = validate_dataset(
        labels_dir=args.labels,
        images_dir=args.images,
        class_names=load_class_names(args.classes),
        duplicate_iou=args.duplicate_iou,
    )

    payload = report.to_dict()
    text = json.dumps(payload, ensure_ascii=False, indent=2)

    if args.report:
        Path(args.report).parent.mkdir(parents=True, exist_ok=True)
        Path(args.report).write_text(text + "\n", encoding="utf-8")

    print(text)

    if report.error_count:
        return 1
    if args.strict and report.warning_count:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
