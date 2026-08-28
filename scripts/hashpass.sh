#!/usr/bin/env bash
# bcrypt-хэш пароля для config.yaml: scripts/hashpass.sh 'пароль'
set -euo pipefail
cd "$(dirname "$0")/../server"

go run ./cmd/hashpass "$@"
