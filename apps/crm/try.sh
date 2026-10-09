#!/usr/bin/env bash
# Быстрый запуск CRM на своём компьютере для пробы в Telegram.
# Поднимает временный HTTPS-адрес через Cloudflare Quick Tunnel и подключает
# его к боту. Адрес меняется при каждом запуске — для постоянной работы
# разверните сервер (см. README).
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3000}"

fail() {
  echo "❌ $*" >&2
  exit 1
}

command -v node >/dev/null || fail "Нужен Node.js 22.18+ — https://nodejs.org"
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' ||
  fail "Нужен Node.js 22.18+, у вас $(node -v)"

if ! command -v cloudflared >/dev/null; then
  cat >&2 <<'HINT'
❌ Нужен cloudflared (создаёт временный HTTPS-адрес):
   macOS:   brew install cloudflared
   Linux:   https://github.com/cloudflare/cloudflared/releases (cloudflared-linux-amd64)
   Windows: winget install --id Cloudflare.cloudflared
HINT
  exit 1
fi

if ! grep -qs '^BOT_TOKEN=.\+' .env; then
  read -rp "Вставьте токен бота от @BotFather: " token
  echo "BOT_TOKEN=${token}" >> .env
fi

if [ ! -d node_modules ]; then
  echo "📦 Устанавливаю зависимости…"
  npm install --no-audit --no-fund --loglevel=error
fi
echo "🛠  Собираю приложение…"
npx vite build --logLevel error

LOG="$(mktemp)"
cloudflared tunnel --no-autoupdate --url "http://localhost:${PORT}" >"$LOG" 2>&1 &
TUNNEL_PID=$!
trap 'kill "$TUNNEL_PID" 2>/dev/null; rm -f "$LOG"' EXIT

echo "🌐 Поднимаю HTTPS-туннель…"
URL=""
for _ in $(seq 1 60); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -n1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done
[ -n "$URL" ] || fail "Туннель не поднялся. Лог: $(cat "$LOG")"

cat <<INFO

✅ CRM доступна: ${URL}
   Откройте вашего бота в Telegram, нажмите /start, затем кнопку «CRM».
   Кто откроет первым — станет администратором.
   Остановить: Ctrl+C

INFO

WEBAPP_URL="$URL" PORT="$PORT" node --disable-warning=ExperimentalWarning server/index.ts
