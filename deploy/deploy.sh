#!/usr/bin/env bash
# Продакшн-деплой: домен из deploy/Caddyfile, TLS — Let's Encrypt (Caddy
# выпускает сам при первом обращении). При первом запуске генерирует
# секреты: ключи livekit (если остались dev) и PUBLIC_API_KEY в .env.
#
# Перед запуском: DNS (hub.<домен> + turn.<домен> → сервер), домен в
# deploy/Caddyfile, сотрудники в config.yaml, STT/LLM ключи в .env.
#
# Использование: bash deploy/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

command -v docker >/dev/null || { echo "Нет docker" >&2; exit 1; }
command -v openssl >/dev/null || { echo "Нет openssl" >&2; exit 1; }
[ -f config.yaml ] || {
  echo "Нет config.yaml: cp config.example.yaml config.yaml, впиши сотрудников (пароль: scripts/hashpass.sh 'пароль')" >&2
  exit 1
}

# Домен из первого сайт-блока Caddyfile.
DOMAIN=$(grep -m1 -oP '^[a-zA-Z0-9.-]+(?= \{)' deploy/Caddyfile || true)
case "$DOMAIN" in
  *.example.com|"")
    echo "Замени example.com на свой домен в deploy/Caddyfile (и добавь A-записи hub./turn. → сервер)" >&2
    exit 1
    ;;
esac

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

docker compose -f deploy/docker-compose.yml up -d --build

echo
echo "Готово: https://$DOMAIN (сертификат выпустит Caddy при первом обращении)"
echo "Проверка: curl -H \"X-API-Key: \$(grep PUBLIC_API_KEY .env | cut -d= -f2)\" https://$DOMAIN/api/public/status"
echo "TURN: раскомментируй блок turn: в deploy/livekit.yaml после выпуска серта (см. docs/DEPLOY.md)."
