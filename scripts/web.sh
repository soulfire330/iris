#!/usr/bin/env bash
# Фронт (bun — зависимость только web/). Использование: scripts/web.sh dev|build
set -euo pipefail
cd "$(dirname "$0")/../web"

case "${1:-}" in
  dev)   bun run dev ;;
  build) bun run build ;;
  *) echo "Использование: scripts/web.sh dev|build" >&2; exit 1 ;;
esac
