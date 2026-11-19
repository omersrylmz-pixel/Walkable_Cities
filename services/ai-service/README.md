# AI Servisi (FastAPI + ONNX Runtime)

Nesne tespiti (YOLO26 / RF-DETR) ve kaldırım / yaya geçidi segmentasyonu ile ihlal tespiti yapan çıkarım servisi.

> **Faz 0 durumu:** Uygulama iskeleti, sağlık uçları ve yapılandırma hazır. Model çıkarımı Faz 2'de eklenecek.

## Planlanan Uçlar

| Metot | Yol | Açıklama |
| --- | --- | --- |
| `GET` | `/health` | Liveness |
| `GET` | `/health/ready` | Model / bağımlılık hazırlığı |
| `GET` | `/docs` | OpenAPI (Swagger UI) |
| `POST` | `/v1/analyze` | Görsel + metadata -> tespitler + overlap + güven (Faz 2) |
| `GET` | `/v1/models` | Yüklü model sürümleri (Faz 2) |

## Çıkarım Hattı (Faz 2)

```text
görsel
  └─> ön işleme (resize, normalize, EXIF yönü)
        ├─> nesne tespiti (YOLO26 / RF-DETR, ONNX)
        │      └─> araç, tabela, tezgâh, konteyner, inşaat malzemesi kutuları
        └─> segmentasyon (kaldırım / yaya geçidi maskesi)
               └─> overlap = |engel_maskesi ∩ yürünebilir_alan| / |engel_maskesi|
                     └─> güven skoru = f(detector_conf, overlap, segment_quality)
                           └─> karar: >=0.85 kabul | 0.60-0.84 inceleme | <0.60 ret
```

## Yerel Geliştirme

```bash
cd services/ai-service
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/macOS
# source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

- Sağlık: <http://localhost:8000/health>
- OpenAPI: <http://localhost:8000/docs>

## Docker

```bash
# kök dizinden
docker compose up -d --build ai-service
```

## Model Ağırlıkları

- `models/` dizini Git'e **girmez** (`*.onnx`, `*.pt`, `*.pth` hariç tutulur).
- Ağırlıklar `ml-pipeline` çıktısından kopyalanır veya CI/CD artefaktı olarak indirilir.
- Üretimde salt-okunur volume / nesne depolama üzerinden bağlanır.

## Yapı

```text
app/
├── api/
│   └── health.py        # liveness / readiness
├── core/
│   └── config.py        # pydantic-settings
└── main.py              # FastAPI uygulaması
```
