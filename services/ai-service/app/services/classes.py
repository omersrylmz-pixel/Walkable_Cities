"""Model sınıf şeması ve ihlal türü eşlemesi."""

from __future__ import annotations

import json
from pathlib import Path

DEFAULT_CLASSES: tuple[str, ...] = (
    "vehicle_on_walkway",
    "vehicle_on_crosswalk",
    "street_furniture",
    "construction_material",
    "container_obstacle",
    "surface_defect",
)

#: modele özgü sınıf adı -> (ihbar türü, varsayılan ağırlık)
CLASS_RULES: dict[str, tuple[str, int]] = {
    "vehicle_on_walkway": ("kaldirim_isgali", 4),
    "vehicle_on_crosswalk": ("yaya_gecidi_ihlali", 5),
    "street_furniture": ("kaldirim_isgali", 3),
    "construction_material": ("gecici_engel", 3),
    "container_obstacle": ("sabit_engel", 4),
    "surface_defect": ("yuzey_bozulmasi", 3),
}

#: COCO ön eğitimli modellerden gelen sınıflar için kaba eşleme.
COCO_ALIASES: dict[str, str] = {
    "car": "vehicle_on_walkway",
    "truck": "vehicle_on_walkway",
    "bus": "vehicle_on_walkway",
    "motorcycle": "vehicle_on_walkway",
    "bicycle": "vehicle_on_walkway",
    "bench": "street_furniture",
    "potted plant": "street_furniture",
    "traffic light": "street_furniture",
    "fire hydrant": "street_furniture",
    "stop sign": "street_furniture",
    "suitcase": "construction_material",
}

UNKNOWN_RULE = ("kaldirim_isgali", 3)


def load_class_names(classes_path: Path, override: str = "") -> list[str]:
    """Sınıf adlarını yükler.

    Öncelik: `MODEL_CLASSES` ortam değişkeni -> `classes.json` -> yerleşik şema.
    """
    if override.strip():
        return [name.strip() for name in override.split(",") if name.strip()]

    if classes_path.exists():
        try:
            payload = json.loads(classes_path.read_text(encoding="utf-8"))
            if isinstance(payload, list) and all(isinstance(item, str) for item in payload):
                return [str(item) for item in payload]
        except (OSError, json.JSONDecodeError):
            pass

    return list(DEFAULT_CLASSES)


def rule_for(label: str) -> tuple[str, int]:
    """Sınıf adını (ihbar türü, ağırlık) çiftine çevirir."""
    normalized = label.strip().lower()
    canonical = COCO_ALIASES.get(normalized, normalized)
    return CLASS_RULES.get(canonical, UNKNOWN_RULE)
