#!/usr/bin/env bash
# Деплой без домена (LAN): Caddy раздаёт HTTPS по IP-адресу сервера с
# self-signed сертификатом (внутренний CA Caddy). Браузер один раз спросит
# про сертификат — прими, дальше микрофон и wss работают.
#
# Без домена нет TURN: участники должны быть в одной сети с сервером.
#
# Использование: bash deploy/deploy-self-signed.sh [IP]
#   IP определится сам (hostname -I); передай вручную, если нужно другое.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

command -v docker >/dev/null || { echo "Нет docker" >&2; exit 1; }
command -v bun >/dev/null || { echo "Нет bun" >&2; exit 1; }
[ -f config.yaml ] || {
  echo "Нет config.yaml: cp config.example.yaml config.yaml, впиши сотрудников (пароль: bun hashpass 'пароль')" >&2
  exit 1
}

IP="${1:-}"
if [ -z "$IP" ]; then
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi
if [ -z "$IP" ]; then
  echo "Не удалось определить IP сервера. Передай вручную: bash deploy/deploy-self-signed.sh 10.20.20.14" >&2
  exit 1
fi

cat > deploy/Caddyfile.self-signed <<EOF
# Сгенерирован deploy-self-signed.sh — не редактировать, перезапусти скрипт.
https://$IP {
	tls internal
	handle /rtc* {
		reverse_proxy 127.0.0.1:7880
	}
	reverse_proxy backend:8090
}
EOF

bun web:build
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.self-signed.yml up -d --build

echo
echo "Готово: https://$IP"
echo "Браузер покажет предупреждение о сертификате — прими («Дополнительно → продолжить»)."
echo "TURN недоступен без домена: все участники должны быть в одной сети с сервером."
