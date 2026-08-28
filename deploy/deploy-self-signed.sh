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
[ -f config.yaml ] || {
  echo "Нет config.yaml: cp config.example.yaml config.yaml, впиши сотрудников (пароль: scripts/hashpass.sh 'пароль')" >&2
  exit 1
}

# Адреса сайта: переданный IP (bash deploy/deploy-self-signed.sh 1.2.3.4) или все
# IPv4 хоста кроме docker-мостов (LAN, netbird, wireguard и т.д. — Caddy отдаст
# self-signed серт на каждый).
if [ -n "${1:-}" ]; then
  ADDRS=("$1")
elif command -v hostname >/dev/null; then
  mapfile -t ADDRS < <(hostname -I | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | grep -vE '^172\.(1[7-9]|2[0-9]|3[01])\.')
else
  ADDRS=()
fi
if [ "${#ADDRS[@]}" -eq 0 ]; then
  echo "Не удалось определить IP сервера. Передай вручную: bash deploy/deploy-self-signed.sh 10.20.20.14" >&2
  exit 1
fi
SITES=$(printf 'https://%s, ' "${ADDRS[@]}")
SITES=${SITES%, }

cat > deploy/Caddyfile.self-signed <<EOF
# Сгенерирован deploy-self-signed.sh — не редактировать, перезапусти скрипт.
$SITES {
	tls internal
	handle /rtc* {
		reverse_proxy 127.0.0.1:7880
	}
	reverse_proxy 127.0.0.1:8090
}
EOF

docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.self-signed.yml up -d --build

echo
echo "Готово: https://${ADDRS[0]}"
echo "Браузер покажет предупреждение о сертификате — прими («Дополнительно → продолжить»)."
echo "TURN недоступен без домена: все участники должны быть в одной сети с сервером."
