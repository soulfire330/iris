#!/usr/bin/env bash
# Dev: инфраструктура (valkey + livekit + egress) + бэкенд + vite + секретарь.
# Ctrl+C останавливает процессы, инфраструктура остаётся (scripts/infra.sh down).
set -euo pipefail
cd "$(dirname "$0")/.."

./scripts/infra.sh up
./scripts/backend.sh &
./scripts/web.sh dev &
./scripts/secretary.sh &
wait
