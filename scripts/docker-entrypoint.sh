#!/bin/sh
set -eu

mkdir -p "${IMAGE_GEN_DATA_DIR:-/app/data}" /app/config
chown -R node:node "${IMAGE_GEN_DATA_DIR:-/app/data}" /app/config 2>/dev/null || true

if [ "$(id -u)" = "0" ]; then
  exec su-exec node "$@"
fi

exec "$@"
