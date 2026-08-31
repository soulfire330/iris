#!/usr/bin/env bash
# Продакшн-деплой: поднимает стек — `docker compose up -d --build` (фронт
# собирается в Docker-образе). Reverse proxy, TLS и DNS этот скрипт не трогает:
# они настраиваются один раз тем, кто деплоит (см. docs/DEPLOY.md).
#
# При первом запуске генерирует секреты: ключи livekit (если остались dev)
# и PUBLIC_API_KEY в .env.
#
# Перед запуском: сотрудники в config.yaml, STT/LLM ключи в .env,
# reverse proxy настроен на апстримы 127.0.0.1:8090 и /rtc → 127.0.0.1:7880.
#
# Использование: bash deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

command -v docker >/dev/null || { echo "Нет docker" >&2; exit 1; }
command -v openssl >/dev/null || { echo "Нет openssl" >&2; exit 1; }
[ -f config.yaml ] || {
  echo "Нет config.yaml: cp config.example.yaml config.yaml, впиши сотрудников (пароль: scripts/hashpass.sh 'пароль')" >&2
  exit 1
}

# Секреты livekit: dev-ключи меняем при первом деплое (все три файла синхронно).
if grep -q '^  devkey:' deploy/livekit.yaml; then
  KEY=$(openssl rand -hex 8)
  SECRET=$(openssl rand -hex 32)
  sed -i "s/^  devkey:.*/  $KEY: $SECRET/" deploy/livekit.yaml
  sed -i "s/api_key: .*/api_key: $KEY/; s/api_secret: .*/api_secret: $SECRET/" config.yaml
  sed -i "s/api_key: .*/api_key: $KEY/; s/api_secret: .*/api_secret: $SECRET/" deploy/egress.yaml
  echo "Сгенерированы новые ключи livekit (dev-ключи заменены)."
fi

# Dev-ключи не должны остаться ни в одном файле конфигурации livekit/egress.
if grep -q devkey deploy/livekit.yaml deploy/egress.yaml config.yaml; then
  echo "Ошибка: dev-ключ livekit остался в конфигурации (livekit.yaml/egress.yaml/config.yaml)" >&2
  exit 1
fi

# PUBLIC_API_KEY для публичного API.
[ -f .env ] || { cp .env.example .env; echo "Создан .env из шаблона."; }
if ! grep -q '^PUBLIC_API_KEY=.\+' .env; then
  echo "PUBLIC_API_KEY=$(openssl rand -hex 32)" >> .env
  echo "Сгенерирован PUBLIC_API_KEY (в .env)."
fi

docker compose up -d --build

echo
echo "Готово: стек поднят. HTTPS отдаёт твой reverse proxy (см. docs/DEPLOY.md):"
echo "  /rtc* → 127.0.0.1:7880 (livekit), остальное → 127.0.0.1:8090 (backend)"
echo "Проверка: curl -H \"X-API-Key: \$(grep PUBLIC_API_KEY .env | cut -d= -f2)\" https://hub.<домен>/api/public/status"
echo "TURN: положи серт в deploy/certs/ и раскомментируй блок turn: в deploy/livekit.yaml."