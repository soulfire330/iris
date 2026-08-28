#!/usr/bin/env bash
# Воркер AI-сводок локально (нужен .env с STT/LLM).
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; . ./.env 2>/dev/null || true; set +a
cd server
RECORDINGS_DIR=../data/recordings LLM_PROMPT_FILE=../deploy/secretary-prompt.md \
  go run ./cmd/secretary
