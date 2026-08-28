#!/usr/bin/env bash
# bcrypt-хэш пароля для config.yaml — без Go на хосте, считает golang-контейнер.
# Использование: scripts/hashpass.sh 'пароль'
set -euo pipefail
cd "$(dirname "$0")/.."

# office-go: кэш модулей и компиляции переживает запуски; первый раз тянет образ.
exec docker run --rm \
  -v office-go:/go -e GOCACHE=/go/cache \
  -v "$PWD/server":/src -w /src \
  golang:1.26-alpine go run ./cmd/hashpass "$@"
