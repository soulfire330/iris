#!/usr/bin/env bash
# Полный compose-стек (Caddy + бэкенд в контейнере, фронт собирается в образе) — для прода.
# Использование: scripts/stack.sh up|down
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:-}" in
  up)   docker compose -f deploy/docker-compose.yml up -d --build ;;
  down) docker compose -f deploy/docker-compose.yml down ;;
  *) echo "Использование: scripts/stack.sh up|down" >&2; exit 1 ;;
esac
