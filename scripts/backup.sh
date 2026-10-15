#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
mkdir -p backups
name="browsernas-$(date +%Y%m%d-%H%M%S).tar.gz"
docker compose stop
trap 'docker compose up -d --wait --wait-timeout 180' EXIT
docker compose --profile tools run --rm --no-deps tools tar -czf "/backup/$name" -C /source settings files
printf 'Backup saved: backups/%s\n' "$name"
