# ML Pipeline

Veri seti hazırlama, etiket dönüşümü/doğrulama, model eğitimi, değerlendirme ve ONNX export süreçleri.

> **Faz 2 durumu:** COCO -> YOLO dönüştürücüsü, etiket doğrulama raporu, tespit/segmentasyon metrikleri ve ONNX export yardımcısı hazır ve test edildi. Gerçek veri seti, GPU ve eğitilmiş ağırlıklar olmadığı için **YOLO26 / RF-DETR eğitimi ve mAP/mIoU ölçümleri henüz çalıştırılmadı**; ilgili yol haritası maddeleri açık.

## Görev Tanımı

| Görev | Model | Çıktı |
| --- | --- | --- |
| Nesne tespiti | YOLO26 (hız/denge), RF-DETR (doğruluk karşılaştırması) | Engel kutuları + sınıf + güven |
| Segmentasyon | Kaldırım / yaya geçidi (U-Net / SegFormer / DeepLabv3+) | Yürünebilir alan maskesi |
| Örtüşme | Geometrik hesap (model değil) | `overlap_ratio`, `walkable_area_ratio` |
| Skor füzyonu | Kalibre edilmiş ağırlıklı birleşim | `confidence_score` (0–1) |

## Sınıf Şeması

```text
0 vehicle_on_walkway     # kaldırım üzerinde araç
1 vehicle_on_crosswalk   # yaya geçidinde araç
2 street_furniture       # tabela, bank, çöp kutusu
3 construction_material  # inşaat malzemesi, moloz
4 container_obstacle     # konteyner, trafo
5 surface_defect         # çukur, kırık taş
-- segmentasyon sınıfları
0 background
1 sidewalk
2 crosswalk
3 road
4 obstacle
```

Sınıf -> ihlal türü -> önem eşlemesi [`configs/label_map.yaml`](configs/label_map.yaml), AI servisi için JSON karşılığı [`configs/classes.example.json`](configs/classes.example.json) dosyasındadır.

## Akış

```text
1. Veri toplama        -> data/raw/ (git dışı)
2. Etiketleme          -> CVAT / Label Studio export (COCO + YOLO + maskeler)
3. Dönüştürme          -> src.datasets.coco_to_yolo
4. Doğrulama           -> src.datasets.validate_labels (JSON rapor)
5. Eğitim              -> YOLO26 / RF-DETR / segmentasyon (veri + GPU bekliyor)
6. Değerlendirme       -> src.evaluation.metrics (mAP50, mAP50-95, mIoU)
7. Kalibrasyon         -> güven skoru (temperature scaling / isotonic)
8. Export              -> src.export.to_onnx (opset 17+, ONNX Runtime doğrulama)
9. Kayıt               -> model adı + sürüm + metrik özeti
```

## Kurulum

```bash
cd ml-pipeline
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/macOS
# source .venv/bin/activate

pip install -r requirements-dev.txt
```

`requirements.txt` yalnızca çekirdek yardımcıları (NumPy) kurar. Eğitim/export bağımlılıkları (`ultralytics`, `torch`, `onnx`, `onnxruntime`, `opencv-python-headless`) dosyada yorumlu olarak listelenmiştir; veri seti ve GPU ortamı hazır olduğunda etkinleştirin.

## COCO -> YOLO Dönüşümü

```bash
python -m src.datasets.coco_to_yolo \
  --annotations data/raw/annotations.json \
  --images data/raw/images \
  --output data/processed/detector \
  --class-map data/raw/class-map.json \
  --copy-images
```

`--class-map` verilmezse COCO kategorileri id sırasına göre kullanılır. Örnek eşleme:

```json
{
  "1": "vehicle_on_walkway",
  "2": "street_furniture",
  "3": "construction_material"
}
```

Çıktı:

```text
data/processed/detector/
├── images/                 # --copy-images verilirse
├── labels/*.txt            # class_id cx cy w h (normalize)
├── classes.txt
├── data.yaml               # Ultralytics uyumlu
└── conversion-report.json  # dönüşen/atlanan kutu, sınıf dağılımı
```

Kurallar:

- Kutular görsel sınırlarına kırpılır; 1 pikselden küçük kalanlar atlanır.
- `iscrowd=1` ve bilinmeyen kategori etiketleri rapora yazılarak atlanır.
- Etiketsiz görseller için boş `.txt` üretilir (`--skip-empty` ile kapatılabilir).
- Aynı dosya adı çakışmaları `_1`, `_2` sonekleriyle çözülür.

## Etiket Doğrulama

```bash
python -m src.datasets.validate_labels \
  --labels data/processed/detector/labels \
  --images data/processed/detector/images \
  --classes data/processed/detector/classes.txt \
  --report data/processed/detector/validation-report.json
```

Kontroller:

- Satır biçimi, sayısal alanlar, sınıf indeksi aralığı
- Normalize merkez/ boyut sınırları, görsel dışına taşan kutular
- Aynı görselde neredeyse aynı kutular (IoU > `--duplicate-iou`, varsayılan `0.95`)
- Görseli olmayan etiket (hata) ve etiketi olmayan görsel (uyarı)
- Boş etiket dosyaları, eksik sınıflar, sınıf dengesizliği

Rapor `ok`, `error_count`, `warning_count`, `class_distribution` ve `imbalance_ratio` alanlarını içerir. Hata varsa komut `1` ile çıkar; `--strict` uyarıları da başarısız sayar.

## Değerlendirme Metrikleri

```python
from src.evaluation.metrics import GroundTruth, Prediction, evaluate_detections

metrics = evaluate_detections(
    [
        GroundTruth("img1", 0, (0, 0, 10, 10)),
        GroundTruth("img1", 1, (20, 20, 30, 30)),
    ],
    [
        Prediction("img1", 0, (0, 0, 10, 10), 0.91),
        Prediction("img1", 1, (20, 20, 30, 30), 0.84),
    ],
)

print(metrics.map50, metrics.map50_95, metrics.precision, metrics.recall)
```

- Sınıf duyarlı greedy eşleştirme, skor azalan sırada.
- AP all-point interpolasyonu ile hesaplanır.
- `mAP50` ve `mAP50-95` yalnızca GT'si bulunan sınıflar üzerinden ortalanır.
- `precision` / `recall` / `f1`, en iyi F1 noktasında raporlanır.

Segmentasyon:

```python
from src.evaluation.metrics import evaluate_segmentation

result = evaluate_segmentation(pred_masks, gt_masks, num_classes=5)
print(result.mean_iou, result.per_class_iou, result.pixel_accuracy)
```

Varsayılan olarak arka plan (`0`) mIoU ortalamasına dahil edilmez; `include_background=True` ile eklenir.

## ONNX Export

```bash
python -m src.export.to_onnx \
  --weights runs/detect/train/weights/best.pt \
  --output ../services/ai-service/models/detector.onnx \
  --imgsz 640 --opset 17 --dynamic --verify
```

- `ultralytics` ve `onnxruntime` yalnızca bu komut çalışırken gerekir.
- `--verify` giriş/çıkış şekillerini ve sürüyü raporlar; `--no-run` ile yalnızca şekil kontrolü yapılır.
- AI servisi girişi `[1, 3, S, S]` float32 RGB (0–1) bekler. YOLO export'u bu sözleşmeye uyar; DETR için `DETECTOR_OUTPUT_FORMAT=detr` ayarlanmalıdır.

## Testler

```bash
cd ml-pipeline
python -m pytest
```

Kapsam: dönüşüm/ kırpma / atlama kuralları, sınıf eşlemesi, etiket doğrulama hataları, AP/mAP hesapları, segmentasyon karmaşıklık matrisi ve mIoU. Testler veri seti veya ağırlık gerektirmez.

## Model Sürümleme

`<görev>-<mimari>-<veri_sürümü>-<tarih>` biçimi:

```text
detector-yolo26s-v1.2-2026-12-01.onnx
detector-rfdetr-base-v1.2-2026-12-01.onnx
segmenter-segformer-b2-v1.0-2026-11-20.onnx
```

Sürüm bilgisi `report_evaluations.detector_version` / `segmenter_version` alanlarına yazılır; böylece her kararın hangi modelle üretildiği izlenebilir.

## Değerlendirme İlkeleri

- Test seti eğitimden **coğrafi olarak ayrık** tutulur (aynı sokak görüntüleri sızmasın).
- Sınıf bazlı precision/recall raporlanır; düşük frekanslı sınıflar için ayrı eşik önerilir.
- Overlap hesabı için segmentasyon maskesi kalitesi (mIoU) ayrıca raporlanır.
- Karar eşikleri (`0.85` / `0.60`) test setinde precision-recall eğrisi ile doğrulanır.

## Dizin Yapısı

```text
ml-pipeline/
├── configs/
│   ├── label_map.yaml
│   └── classes.example.json
├── data/                     # git dışı (raw/interim/processed)
├── src/
│   ├── datasets/
│   │   ├── coco_to_yolo.py
│   │   └── validate_labels.py
│   ├── evaluation/
│   │   └── metrics.py
│   └── export/
│       └── to_onnx.py
├── tests/
├── requirements.txt
└── requirements-dev.txt
```

> Ağırlıklar ve veri setleri repoya girmez. Çıktılar nesne depolamada (S3/Supabase Storage) veya yerel `models/` dizininde tutulur.
