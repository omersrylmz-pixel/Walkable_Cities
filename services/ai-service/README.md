# AI Servisi (FastAPI + ONNX Runtime)

Nesne tespiti (YOLO26 / RF-DETR) ve kaldırım / yaya geçidi segmentasyonu ile ihlal tespiti yapan çıkarım servisi.

> **Faz 2 durumu:** Uçtan uca çıkarım hattı, ONNX Runtime oturum yönetimi, overlap hesabı, skor füzyonu/kalibrasyonu ve karar bandı hazır. Gerçek ONNX ağırlıkları repoda olmadığı için geliştirme/CI ortamında deterministik **heuristic** yedek hat kullanılır. Ağırlıklar `models/` dizinine konduğunda otomatik olarak devre dışı kalır.

## Uçlar

| Metot | Yol | Açıklama |
| --- | --- | --- |
| `GET` | `/health` | Liveness (Docker healthcheck için hafif) |
| `GET` | `/health/ready` | Model hazırlığı; hazır değilse `503` |
| `GET` | `/v1/models` | Yüklü model sürümleri, sınıf şeması, eşikler |
| `POST` | `/v1/analyze` | Görsel -> tespitler + segmentasyon + overlap + skor + karar |
| `GET` | `/docs` | OpenAPI (Swagger UI) |

Hata yanıtları RFC 7807 `application/problem+json` biçimindedir (`413`, `415`, `422`, `503`).

## Çıkarım Hattı

```text
görsel (JPEG / PNG / WebP)
  └─> çözme + EXIF yönü + alfa düzleştirme + uzun kenarı ANALYSIS_MAX_DIMENSION'a indirme
        ├─> nesne tespiti (YOLO26 / RF-DETR, ONNX)
        │      └─> NMS -> araç, tabela, tezgâh, konteyner, inşaat malzemesi kutuları
        └─> segmentasyon (kaldırım / yaya geçidi, ONNX)
               └─> walkable = sidewalk ∪ crosswalk
                     ├─> overlap_ratio    = Σ|kutu ∩ walkable| / Σ|kutu|
                     ├─> obstruction_ratio = |∪kutu ∩ walkable| / |walkable|
                     └─> skor = 0.45·güven + 0.30·overlap + 0.15·kapsama + 0.10·ağırlık
                           └─> temperature scaling -> karar bandı
```

Karar bandı: `>= 0.85` otomatik kabul, `0.60–0.84` manuel inceleme, `< 0.60` otomatik ret. Hiç tespit yoksa sonuç doğrudan `auto_reject` olur.

## Örnek İstek

```bash
curl -X POST http://localhost:8001/v1/analyze \
  -H "X-Request-ID: demo-1" \
  -F "image=@sokak.jpg;type=image/jpeg" \
  -F "includeMask=true"
```

Yanıt (kısaltılmış):

```json
{
  "requestId": "demo-1",
  "backend": "onnx",
  "deterministic": true,
  "modelVersion": "detector@a1b2c3d4e5f6+segmenter@0f1e2d3c4b5a",
  "image": {
    "width": 1024,
    "height": 768,
    "originalWidth": 2048,
    "originalHeight": 1536,
    "mimeType": "image/jpeg",
    "sha256": "…",
    "byteSize": 184320
  },
  "detections": [
    {
      "label": "vehicle_on_walkway",
      "classId": 0,
      "confidence": 0.91,
      "box": { "x": 120.0, "y": 310.5, "width": 260.0, "height": 180.0 },
      "overlapRatio": 0.87,
      "severity": 4,
      "violationType": "kaldirim_isgali"
    }
  ],
  "segmentation": {
    "walkableAreaRatio": 0.31,
    "sidewalkRatio": 0.28,
    "crosswalkRatio": 0.03,
    "obstacleRatio": 0.04,
    "mask": { "encoding": "rle_counts", "size": [768, 1024], "counts": [0, 12, 4, 9] }
  },
  "metrics": {
    "overlapRatio": 0.87,
    "obstructionRatio": 0.42,
    "topConfidence": 0.91,
    "detectionCount": 1
  },
  "score": { "raw": 0.8312, "calibrated": 0.8312, "temperature": 1.0 },
  "decision": {
    "outcome": "manual_review",
    "status": "pending_review",
    "reason": "Skor 0.83 manuel inceleme bandında (0.60–0.85)",
    "thresholds": { "autoAccept": 0.85, "manualReview": 0.6 }
  },
  "latency": {
    "preprocessMs": 18.2,
    "detectorMs": 74.5,
    "segmenterMs": 51.1,
    "postprocessMs": 4.3,
    "totalMs": 148.1
  },
  "analyzedAt": "2026-11-21T12:00:00+00:00"
}
```

`includeMask=false` (varsayılan) iken `segmentation.mask` alanı `null` döner. Maske, satır-öncelikli ve `0` ile başlayan `rle_counts` kodlamasıdır; `size` alanı `[yükseklik, genişlik]` sırasındadır. `image.width` / `image.height` analiz edilen (yeniden boyutlandırılmış) görseli, `originalWidth` / `originalHeight` ise kaynak görseli bildirir. Tespit kutuları ve maske **analiz edilen görsel** koordinat uzayındadır.

## Model Sözleşmesi (ONNX)

| Model | Giriş | Çıkış |
| --- | --- | --- |
| Detektör (YOLO) | `[1, 3, 640, 640]` float32, RGB, 0–1, letterbox (dolgu `114`) | `[1, 4+C, N]` veya `[1, N, 4+C]`; `cx, cy, w, h` piksel uzayında |
| Detektör (DETR) | `[1, 3, 640, 640]` float32, RGB, 0–1, kareye resize | `boxes` (normalize `cx, cy, w, h`), `scores`, `labels` |
| Segmenter | `[1, 3, 512, 512]` float32, RGB, 0–1 | `[1, C, H, W]` logits veya sınıf indeksleri |

Segmentasyon sınıfları: `0 background`, `1 sidewalk`, `2 crosswalk`, `3 road`, `4 obstacle`.

Sınıf adları şu öncelikle yüklenir:

1. `MODEL_CLASSES` ortam değişkeni (virgülle ayrılmış),
2. `models/classes.json` (JSON string dizisi),
3. yerleşik şema (`vehicle_on_walkway`, `vehicle_on_crosswalk`, `street_furniture`, `construction_material`, `container_obstacle`, `surface_defect`).

Model sürümü, dosyanın SHA-256 özetinin ilk 12 karakteridir. Yanıttaki `modelVersion` ve `/v1/models` çıktısı, her kararın hangi ağırlıklarla üretildiğini izlemeyi sağlar.

## Yedek Hat (Heuristic)

Ağırlık yokken kullanılan hat **doğruluk iddiası taşımaz**:

- Tespit: doygun renkli veya çok koyu bölgeleri ön plan kabul eder, 4-komşuluk BFS ile bağlı bileşenleri kutular.
- Segmentasyon: görselin alt %65'ini yürünebilir alan varsayar.
- Amaç: API sözleşmesini, overlap/skor/karar akışını ve CI testlerini modelden bağımsız doğrulamak.

Üretimde `ALLOW_HEURISTIC_FALLBACK=false` yapın. Bu durumda model yoksa `/health/ready` ve `/v1/analyze` `503` döner. Yanıt her zaman `backend` alanı ile hangi hattın kullanıldığını açıkça bildirir.

## Skor Füzyonu ve Kalibrasyon

| Bileşen | Ağırlık | Not |
| --- | --- | --- |
| Tespit güveni | `0.45` | En yüksek tespit güveni |
| Konum (overlap) | `0.30` | Kutunun yürünebilir alanla örtüşmesi |
| Kapsama | `0.15` | Yürünebilir alanın engellenme oranı; %50'de doyar |
| Ağırlık (severity) | `0.10` | İhlal türünün 1–5 önem değeri |

Kalibrasyon `sigmoid(logit(p) / T)` biçimindedir. `SCORE_TEMPERATURE=1.0` girdiyi değiştirmez; `T > 1` skoru `0.5`'e yumuşatır. Sıcaklık, doğrulama seti üzerinde ayrı bir kalibrasyon adımında seçilmelidir.

## Yapılandırma

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `MODEL_DIR` | `./models` | ONNX ağırlık dizini |
| `DETECTOR_MODEL_FILE` | `detector.onnx` | Detektör dosyası |
| `SEGMENTER_MODEL_FILE` | `segmenter.onnx` | Segmenter dosyası |
| `DETECTOR_OUTPUT_FORMAT` | `yolo` | `yolo` veya `detr` |
| `DETECTOR_INPUT_SIZE` | `640` | Kare giriş boyutu |
| `SEGMENTER_INPUT_SIZE` | `512` | Kare giriş boyutu |
| `DETECTOR_CONFIDENCE_THRESHOLD` | `0.25` | NMS öncesi güven eşiği |
| `DETECTOR_IOU_THRESHOLD` | `0.45` | NMS IoU eşiği |
| `MAX_DETECTIONS` | `50` | Görsel başına üst sınır |
| `MODEL_CLASSES` | boş | Virgülle ayrılmış sınıf listesi |
| `ANALYSIS_MAX_DIMENSION` | `1024` | Analiz öncesi uzun kenar sınırı |
| `MAX_UPLOAD_MB` | `12` | Yükleme boyutu sınırı |
| `MAX_IMAGE_DIMENSION` | `4096` | Mutlak piksel kenarı sınırı |
| `ONNX_INTRA_OP_THREADS` | `2` | CPU iş parçacığı sayısı |
| `SCORE_TEMPERATURE` | `1.0` | Kalibrasyon sıcaklığı |
| `ALLOW_HEURISTIC_FALLBACK` | `true` | Ağırlık yoksa yedek hat |
| `WARMUP_ON_STARTUP` | `true` | Açılışta sıfır tensörle ısınma |
| `AUTO_ACCEPT_THRESHOLD` | `0.85` | Otomatik kabul eşiği |
| `MANUAL_REVIEW_THRESHOLD` | `0.60` | Manuel inceleme alt eşiği |

## Yerel Geliştirme

```bash
cd services/ai-service
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/macOS
# source .venv/bin/activate

pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8001
```

- Sağlık: <http://localhost:8001/health>
- Hazırlık: <http://localhost:8001/health/ready>
- OpenAPI: <http://localhost:8001/docs>

## Testler

```bash
cd services/ai-service
python -m pytest
```

Testler sentetik görsellerle çalışır; ONNX ağırlığı gerektirmez. Kapsam:

- Görsel çözme, EXIF/alfa, boyut sınırları, letterbox, RLE round-trip
- Overlap hesabının kesinliği, skor füzyonu, temperature scaling, karar bantları
- `/v1/analyze` uçtan uca (heuristic), determinizm, maske, `413/415/422/503`
- `/v1/models` ve `/health/ready` durumları

## Docker

```bash
# kök dizinden
docker compose up -d --build ai-service
```

İmaj `python:3.12-slim` tabanlıdır ve ONNX Runtime için `libgomp1` içerir. Model dizini salt-okunur volume olarak bağlanır.

## Model Ağırlıkları

- `models/` dizini Git'e **girmez** (`*.onnx`, `*.pt`, `*.pth` hariç tutulur).
- Ağırlıklar `ml-pipeline` çıktısından kopyalanır veya CI/CD artefaktı olarak indirilir.
- Üretimde salt-okunur volume / nesne depolama üzerinden bağlanır.
- Örnek sınıf dosyası: `ml-pipeline/configs/classes.example.json` -> `models/classes.json`.

## Yapı

```text
app/
├── api/
│   ├── analyze.py       # POST /v1/analyze
│   ├── errors.py        # RFC 7807 hata yanıtları
│   ├── health.py        # liveness / readiness
│   └── models.py        # GET /v1/models
├── core/
│   └── config.py        # pydantic-settings
├── schemas/
│   └── analysis.py      # camelCase API şemaları
├── services/
│   ├── analyzer.py      # uçtan uca orkestrasyon
│   ├── classes.py       # sınıf şeması / ihlal eşlemesi
│   ├── detector.py      # YOLO + DETR adaptörleri, NMS
│   ├── heuristic.py     # geliştirme yedek hattı
│   ├── imaging.py       # çözme, letterbox, RLE
│   ├── onnx_models.py   # oturum kaydı, warm-up, sürüm
│   ├── scoring.py       # overlap, füzyon, karar
│   └── segmenter.py     # segmentasyon adaptörü
└── main.py              # uygulama fabrikası + lifespan
```
