# PostGIS tabanlı imaj + h3-pg eklentisi
#
# Neden özel imaj?
#   Projenin mekânsal indeksleme katmanı H3 altıgen ızgarasına dayanır.
#   h3-pg resmi postgis imajında bulunmadığı için PGDG deposundan kurulur.
#
# Neden apt-archive?
#   postgis/postgis:16-3.4 Debian 11 (bullseye) tabanlıdır ve PGDG'nin canlı
#   bullseye deposu kapatılmıştır. PostgreSQL'in resmî arşiv deposu kullanılır.
#   (İmajın içindeki PGDG imza anahtarı yeniden kullanılır.)
#
# h3-pg kurulamazsa (ağ kısıtı) init.sql eklentiyi atlar ve h3_cell kolonu
# uygulama katmanında doldurulur. Şema yine de yüklenir.

FROM postgis/postgis:16-3.4

ARG DEBIAN_FRONTEND=noninteractive

RUN set -eux; \
    echo "deb [signed-by=/usr/local/share/keyrings/postgres.gpg.asc] https://apt-archive.postgresql.org/pub/repos/apt bullseye-pgdg main 16" \
        > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-16-h3; \
    rm -rf /var/lib/apt/lists/*

# Doğrulama: h3 kontrol dosyası imajda bulunmalı.
RUN test -f /usr/share/postgresql/16/extension/h3.control

# init.sql / docker-entrypoint-initdb.d üzerinden çalıştırılır.
