# syntax=docker/dockerfile:1
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# ONNX Runtime / OpenCV için gerekli sistem kütüphaneleri Faz 2'de eklenecek:
#   apt-get install -y --no-install-recommends libgomp1 libgl1 libglib2.0-0
RUN addgroup --system app && adduser --system --ingroup app app

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY app ./app

# Model ağırlıkları salt-okunur volume olarak bağlanır (git'e girmez).
RUN mkdir -p /app/models && chown -R app:app /app/models

USER app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
