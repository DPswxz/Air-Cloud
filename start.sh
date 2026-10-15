#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v docker >/dev/null 2>&1; then
  echo 'Install Docker Engine + Compose v2 (Linux), or Docker Desktop (macOS) first: https://docs.docker.com/get-started/get-docker/' >&2
  exit 1
fi
docker info >/dev/null
docker compose version
[ -f .env ] || cp .env.example .env
docker compose up -d --wait --wait-timeout 180
published=$(docker compose port portal 8088 | head -n 1)
printf 'BrowserNAS ready: http://localhost:%s\n' "${published##*:}"
