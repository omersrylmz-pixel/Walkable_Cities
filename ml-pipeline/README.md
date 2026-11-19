# ML Pipeline

Veri seti hazırlama, etiketleme dönüşümleri, model eğitimi, değerlendirme ve ONNX export süreçleri.

> **Faz 0 durumu:** Dizin ve planlama tamamlandı. Eğitim hattı **Faz 2**'de kurulacak.

## Görev Tanımı

| Görev | Model | Çıktı |
| --- | --- | --- |
| Nesne tespiti | YOLO26 (hız/denge), RF-DETR (doğruluk karşılaştırması) | Engel kutuları + sınıf + güven |
| Segmentasyon | Kaldırım / yaya geçidi (U-Net / SegFormer / DeepLabv3+) | Yürünebilir alan maskesi |
| Örtüşme | Geometrik hesap (model değil) | `overlap_ratio`, `walkable_area_ratio` |
| Skor füzyonu | Kalibre edilmiş ağırlıklı birleşim | `confidence_score` (0–1) |

## Sınıf Şeması (öneri)

```text
0 vehicle_on_walkway     # kaldırım üzerinde araç
1 vehicle_on_crosswalk   # yaya geçidinde araç
2 street_furniture       # tabela, bank, çöp kutusu
3 construction_material  # inşaat malzemesi, moloz
4 container_obstacle     # konteyner, trafo
5 surface_defect         # çukur, kırık taş (tespit) / segmentasyon
-- segmentasyon sınıfları
0 background
1 sidewalk
2 crosswalk
3 road
4 obstacle
```

Türkçe ihlal türleri ile eşleme `ml-pipeline/configs/label_map.yaml` dosyasında tutulacak.

## Planlanan Akış

```text
1. Veri toplama        -> data/raw/ (git dışı)
2. Etiketleme          -> CVAT / Label Studio export (YOLO + COCO + maskeler)
3. Doğrulama           -> eksik/hatalı etiket, sınıf dengesi raporu
4. Eğitim              -> YOLO26 / RF-DETR / segmentasyon
5. Değerlendirme       -> mAP50, mAP50-95, IoU, precision/recall (sınıf bazlı)
6. Kalibrasyon         -> güven skoru kalibrasyonu (temperature scaling / isotonic)
7. Export              -> ONNX (opset 17+), dinamik batch, FP16 opsiyonu
8. Kayıt               -> model adı + sürüm + metrik özeti (registry)
```

## Planlanan Klasör Yapısı

```text
ml-pipeline/
├── configs/
│   ├── yolo26.yaml
│   ├── rf_detr.yaml
│   ├── segmentation.yaml
│   └── label_map.yaml
├── data/                 # git dışı (raw/interim/processed)
├── src/
│   ├── datasets/         # dönüştürücüler, doğrulama
│   ├── training/         # eğitim giriş noktaları
│   ├── evaluation/       # metrikler, rapor üretimi
│   ├── export/           # ONNX export + doğrulama
│   └── calibration/      # skor kalibrasyonu
├── notebooks/
└── requirements.txt
```

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

## Çalıştırma (Faz 2)

```bash
cd ml-pipeline
python -m venv .venv
.venv\Scripts\activate      # Windows
pip install -r requirements.txt

python -m src.training.train_detector --config configs/yolo26.yaml
python -m src.export.to_onnx --weights runs/detect/best.pt --output ../services/ai-service/models/yolo26s.onnx
```

> Ağırlıklar ve veri setleri repoya girmez. Çıktılar nesne depolamada (S3/Supabase Storage) veya yerel `models/` dizininde tutulur.
