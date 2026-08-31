#!/usr/bin/env bash
# Dev-инфраструктура: valkey + livekit-server + egress.
# Использование: scripts/infra.sh up|down|logs
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:-}" in
  up)   docker compose -f docker-compose.dev.yml up -d ;;
  down) docker compose -f docker-compose.dev.yml down ;;
  logs) docker compose -f docker-compose.dev.yml logs -f livekit-server ;;
  *) echo "Использование: scripts/infra.sh up|down|logs" >&2; exit 1 ;;
esac
