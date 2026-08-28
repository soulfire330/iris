#!/usr/bin/env bash
# Go-бэкенд (порт 8090).
set -euo pipefail
cd "$(dirname "$0")/../server"

go run . -config ../config.yaml
