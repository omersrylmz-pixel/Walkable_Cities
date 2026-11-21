"""YOLO etiket doğrulama testleri."""

from __future__ import annotations

from pathlib import Path

from src.datasets.validate_labels import load_class_names, validate_dataset

CLASS_NAMES = ["vehicle_on_walkway", "street_furniture"]


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_clean_dataset_passes(tmp_path) -> None:
    labels = tmp_path / "labels"
    images = tmp_path / "images"
    images.mkdir()

    _write(labels / "a.txt", "0 0.5 0.5 0.2 0.2\n1 0.3 0.3 0.2 0.2\n")
    _write(labels / "b.txt", "0 0.2 0.2 0.2 0.2\n")
    (images / "a.jpg").write_bytes(b"a")
    (images / "b.png").write_bytes(b"b")

    report = validate_dataset(
        labels_dir=labels,
        images_dir=images,
        class_names=CLASS_NAMES,
    )

    assert report.ok
    assert report.error_count == 0
    assert report.warning_count == 0
    assert report.label_files == 2
    assert report.images == 2
    assert report.boxes == 3
    assert report.class_distribution == {
        "0:vehicle_on_walkway": 2,
        "1:street_furniture": 1,
    }
    assert report.imbalance_ratio == 2.0


def test_invalid_lines_are_reported(tmp_path) -> None:
    labels = tmp_path / "labels"
    _write(
        labels / "bad.txt",
        "\n".join(
            [
                "0 0.5 0.5 0.2 0.2",
                "0 0.5 0.5 0.2 0.2",
                "2 0.5 0.5 0.1 0.1",
                "abc 0.5 0.5 0.1 0.1",
                "0 0.5 0.5 0 0.1",
                "0 1.2 0.5 0.1 0.1",
                "0 nan 0.5 0.1 0.1",
                "0 0.5 0.5 0.1",
                "0 0.9 0.5 0.5 0.1",
                "",
            ]
        ),
    )

    report = validate_dataset(labels_dir=labels, class_names=CLASS_NAMES)
    codes = {issue.code for issue in report.issues}

    assert not report.ok
    assert report.error_count == 6
    assert report.duplicate_boxes == 1
    assert {
        "duplicate_box",
        "class_out_of_range",
        "invalid_class_id",
        "invalid_size",
        "center_out_of_range",
        "non_finite_coordinate",
        "invalid_field_count",
        "box_out_of_bounds",
    } <= codes


def test_missing_label_and_orphan_label_are_reported(tmp_path) -> None:
    labels = tmp_path / "labels"
    images = tmp_path / "images"
    images.mkdir()

    _write(labels / "a.txt", "")
    _write(labels / "orphan.txt", "0 0.5 0.5 0.2 0.2\n")
    (images / "a.jpg").write_bytes(b"a")
    (images / "c.png").write_bytes(b"c")

    report = validate_dataset(
        labels_dir=labels,
        images_dir=images,
        class_names=CLASS_NAMES,
    )
    codes = {issue.code for issue in report.issues}

    assert "empty_label_file" in codes
    assert "missing_label" in codes
    assert "orphan_label" in codes
    assert report.error_count == 1
    assert report.empty_label_files == 1


def test_missing_classes_and_imbalance_warnings(tmp_path) -> None:
    labels = tmp_path / "labels"
    lines = ["0 0.5 0.5 0.1 0.1"] * 12
    _write(labels / "a.txt", "\n".join(lines))

    report = validate_dataset(
        labels_dir=labels,
        class_names=["class_a", "class_b", "class_c"],
    )
    codes = {issue.code for issue in report.issues}

    assert "missing_classes" in codes
    assert "class_imbalance" not in codes  # yalnızca tek sınıf örneği var
    assert report.class_distribution["1:class_b"] == 0


def test_load_class_names(tmp_path) -> None:
    path = tmp_path / "classes.txt"
    path.write_text("# yorum\ncar\n\nbench\n", encoding="utf-8")

    assert load_class_names(path) == ["car", "bench"]
    assert load_class_names(None) == []
