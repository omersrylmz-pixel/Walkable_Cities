"""COCO -> YOLO dönüştürücü testleri."""

from __future__ import annotations

import json

import pytest

from src.datasets.coco_to_yolo import build_class_map, convert_coco, load_class_map


def _coco_fixture() -> dict:
    return {
        "images": [
            {"id": 1, "file_name": "street_a.jpg", "width": 100, "height": 200},
            {"id": 2, "file_name": "street_b.png", "width": 200, "height": 100},
            {"id": 3, "file_name": "empty.jpg", "width": 50, "height": 50},
        ],
        "categories": [
            {"id": 2, "name": "bench"},
            {"id": 1, "name": "car"},
        ],
        "annotations": [
            {"id": 1, "image_id": 1, "category_id": 1, "bbox": [10, 20, 30, 40]},
            {"id": 2, "image_id": 1, "category_id": 2, "bbox": [0, 0, 100, 200]},
            {"id": 3, "image_id": 2, "category_id": 1, "bbox": [190, 90, 20, 20]},
            {"id": 4, "image_id": 3, "category_id": 1, "bbox": [0, 0, 0, 0]},
            {"id": 5, "image_id": 2, "category_id": 99, "bbox": [1, 1, 10, 10]},
            {
                "id": 6,
                "image_id": 2,
                "category_id": 1,
                "bbox": [5, 5, 10, 10],
                "iscrowd": 1,
            },
            {"id": 7, "image_id": 999, "category_id": 1, "bbox": [1, 1, 10, 10]},
        ],
    }


def test_convert_coco_writes_yolo_labels_and_metadata(tmp_path) -> None:
    images_dir = tmp_path / "raw"
    images_dir.mkdir()
    for name in ("street_a.jpg", "street_b.png", "empty.jpg"):
        (images_dir / name).write_bytes(b"fake-image-bytes")

    output = tmp_path / "detector"

    report = convert_coco(
        _coco_fixture(),
        images_dir=images_dir,
        output_dir=output,
        copy_images=True,
    )

    assert report.images == 3
    assert report.annotations == 7
    assert report.converted == 3
    assert report.skipped == 4
    assert report.empty_images == 1
    assert report.missing_images == 0
    assert report.class_names == ["car", "bench"]
    assert report.class_distribution == {"bench": 1, "car": 2}
    assert report.skipped_reasons == {
        "crowd_annotation": 1,
        "degenerate_bbox": 1,
        "unknown_category": 1,
        "unknown_image": 1,
    }

    street_a = (output / "labels" / "street_a.txt").read_text(encoding="utf-8").splitlines()
    assert street_a[0] == "0 0.250000 0.200000 0.300000 0.200000"
    assert street_a[1] == "1 0.500000 0.500000 1.000000 1.000000"

    street_b = (output / "labels" / "street_b.txt").read_text(encoding="utf-8").strip()
    assert street_b == "0 0.975000 0.950000 0.050000 0.100000"

    assert (output / "labels" / "empty.txt").read_text(encoding="utf-8") == ""
    assert (output / "classes.txt").read_text(encoding="utf-8") == "car\nbench\n"
    assert (output / "images" / "street_a.jpg").read_bytes() == b"fake-image-bytes"

    data_yaml = (output / "data.yaml").read_text(encoding="utf-8")
    assert '0: "car"' in data_yaml
    assert '1: "bench"' in data_yaml

    saved_report = json.loads((output / "conversion-report.json").read_text(encoding="utf-8"))
    assert saved_report["converted"] == 3


def test_convert_coco_honours_class_map(tmp_path) -> None:
    output = tmp_path / "detector"

    report = convert_coco(
        _coco_fixture(),
        images_dir=tmp_path,
        output_dir=output,
        class_map={"1": "vehicle_on_walkway", "2": "street_furniture"},
    )

    assert report.class_names == ["vehicle_on_walkway", "street_furniture"]
    label = (output / "labels" / "street_a.txt").read_text(encoding="utf-8")
    assert label.splitlines()[0].startswith("0 ")
    assert label.splitlines()[1].startswith("1 ")


def test_convert_coco_clips_boxes_at_image_border(tmp_path) -> None:
    coco = {
        "images": [{"id": 1, "file_name": "edge.png", "width": 200, "height": 100}],
        "categories": [{"id": 1, "name": "car"}],
        "annotations": [
            {"id": 1, "image_id": 1, "category_id": 1, "bbox": [195, 95, 30, 30]},
            {"id": 2, "image_id": 1, "category_id": 1, "bbox": [300, 300, 10, 10]},
        ],
    }

    report = convert_coco(coco, images_dir=tmp_path, output_dir=tmp_path / "out")

    assert report.converted == 1
    assert report.skipped_reasons == {"degenerate_bbox": 1}
    line = (tmp_path / "out" / "labels" / "edge.txt").read_text(encoding="utf-8").strip()
    class_id, cx, cy, width, height = line.split()
    assert class_id == "0"
    assert float(cx) == pytest.approx(0.9875)
    assert float(cy) == pytest.approx(0.975)
    assert float(width) == pytest.approx(0.025)
    assert float(height) == pytest.approx(0.05)


def test_build_class_map_sorts_and_deduplicates_names() -> None:
    mapping, names = build_class_map(
        [
            {"id": 5, "name": "car"},
            {"id": 2, "name": "car"},
            {"id": 9, "name": "bench"},
        ]
    )

    assert mapping == {2: 0, 5: 1, 9: 2}
    assert names == ["car", "car_2", "bench"]


def test_load_class_map_from_json(tmp_path) -> None:
    path = tmp_path / "class-map.json"
    path.write_text('{"2": "bench", "1": "car"}', encoding="utf-8")

    assert load_class_map(path) == {1: "car", 2: "bench"}
    assert load_class_map(None) is None
