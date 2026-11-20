#!/bin/sh
# Konteyner başlangıcında bekleyen veritabanı migrasyonlarını uygular.
# node-pg-migrate DATABASE_URL ortam değişkenini kullanır.
set -e

if [ -n "$DATABASE_URL" ]; then
  echo "[entrypoint] Veritabanı migrasyonları uygulanıyor..."
  npx --no-install node-pg-migrate up
else
  echo "[entrypoint] DATABASE_URL tanımlı değil; migrasyonlar atlandı."
fi

exec "$@"
