#!/usr/bin/env bash
# Установка / обновление CRM на VPS (Ubuntu) за nginx по адресу
#   https://app.сетьпро.рф/crm/
# Запуск (от root):
#   curl -fsSL https://raw.githubusercontent.com/vestoph2-prog/magicui/claude/telegram-crm-deals-l1md34/apps/crm/deploy/install.sh | sudo bash
# Повторный запуск обновляет код и перезапускает сервис; данные и токен сохраняются.
set -euo pipefail

DOMAIN="${DOMAIN:-app.xn--e1ascech4e.xn--p1ai}"   # app.сетьпро.рф в punycode
BASE_PATH="${BASE_PATH:-/crm}"
PORT="${PORT:-3100}"
REPO="${REPO:-https://github.com/vestoph2-prog/magicui.git}"
BRANCH="${BRANCH:-claude/telegram-crm-deals-l1md34}"
SRC_DIR=/opt/setpro-crm
APP_DIR="$SRC_DIR/apps/crm"
DATA_DIR=/var/lib/setpro-crm
ENV_FILE=/etc/setpro-crm.env
SERVICE=setpro-crm
SNIPPET=/etc/nginx/snippets/setpro-crm.conf

say() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
fail() { printf '\n❌ %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Запустите от root (sudo)."
command -v nginx >/dev/null || fail "nginx не найден."

node_ok() {
  command -v node >/dev/null &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'
}

if ! node_ok; then
  say "Устанавливаю Node.js 22"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg git >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
  node_ok || fail "Не удалось установить Node.js 22.18+"
fi
command -v git >/dev/null || apt-get install -y -qq git >/dev/null

say "Загружаю код ($BRANCH)"
if [ -d "$SRC_DIR/.git" ]; then
  git -C "$SRC_DIR" fetch -q --depth 1 origin "$BRANCH"
  git -C "$SRC_DIR" reset -q --hard FETCH_HEAD
else
  git clone -q --depth 1 -b "$BRANCH" "$REPO" "$SRC_DIR"
fi

say "Собираю приложение"
cd "$APP_DIR"
npm install --no-audit --no-fund --loglevel=error
npx vite build --logLevel error

id -u setpro-crm >/dev/null 2>&1 ||
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin setpro-crm
mkdir -p "$DATA_DIR"
chown -R setpro-crm:setpro-crm "$DATA_DIR"

if [ ! -f "$ENV_FILE" ]; then
  say "Настройка"
  token=""
  while [ -z "$token" ]; do
    read -rp "Токен бота от @BotFather: " token </dev/tty
  done
  read -rp "Ваш Telegram ID для роли администратора (Enter — пропустить): " admin_id </dev/tty
  cat >"$ENV_FILE" <<ENV
BOT_TOKEN=${token}
WEBAPP_URL=https://${DOMAIN}${BASE_PATH}/
ADMIN_IDS=${admin_id}
HOST=127.0.0.1
PORT=${PORT}
DB_PATH=${DATA_DIR}/crm.db
ENV
  chmod 600 "$ENV_FILE"
fi

say "Сервис systemd"
cat >/etc/systemd/system/${SERVICE}.service <<UNIT
[Unit]
Description=СетьПро CRM (Telegram Mini App)
After=network-online.target
Wants=network-online.target

[Service]
User=setpro-crm
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=$(command -v node) --disable-warning=ExperimentalWarning server/index.ts
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${DATA_DIR}
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable -q "$SERVICE"
systemctl restart "$SERVICE"

say "nginx: ${BASE_PATH}/ → 127.0.0.1:${PORT}"
mkdir -p "$(dirname "$SNIPPET")"
cat >"$SNIPPET" <<NGINX
# СетьПро CRM — подключается в server { } для ${DOMAIN}
location = ${BASE_PATH} { return 301 ${BASE_PATH}/; }
location ${BASE_PATH}/ {
    proxy_pass http://127.0.0.1:${PORT}/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    client_max_body_size 12m;
    proxy_read_timeout 60s;
}
NGINX

CONF="$(grep -rlE "server_name[^;]*${DOMAIN//./\\.}" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | head -n1 || true)"
[ -n "$CONF" ] || fail "Не нашёл в nginx server { } с server_name ${DOMAIN}. Добавьте вручную в него строку: include ${SNIPPET};"
CONF="$(readlink -f "$CONF")"
if ! grep -q "include ${SNIPPET};" "$CONF"; then
  cp "$CONF" "${CONF}.bak-setpro-crm"
  # После каждой строки server_name с нашим доменом (блоки 80 и 443).
  sed -i -E "/server_name[^;]*${DOMAIN//./\\.}/a\\    include ${SNIPPET};" "$CONF"
fi
if ! nginx -t 2>/tmp/setpro-nginx.log; then
  [ -f "${CONF}.bak-setpro-crm" ] && cp "${CONF}.bak-setpro-crm" "$CONF"
  cat /tmp/setpro-nginx.log >&2
  fail "nginx -t не прошёл, конфиг восстановлен из бэкапа."
fi
systemctl reload nginx

say "Проверка"
for _ in $(seq 1 20); do
  curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/" && break
  sleep 1
done
curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/" || {
  journalctl -u "$SERVICE" -n 30 --no-pager >&2
  fail "Сервис не отвечает, лог выше."
}
code="$(curl -s -o /dev/null -w '%{http_code}' "https://${DOMAIN}${BASE_PATH}/" || true)"
echo "https://${DOMAIN}${BASE_PATH}/ → HTTP ${code}"

cat <<DONE

✅ Готово: https://app.сетьпро.рф${BASE_PATH}/
   1. Откройте бота → /start → кнопка «CRM» (первый вошедший — администратор,
      если не указали ADMIN_IDS).
   2. «Команда» → «Создать ссылку» — для второго менеджера и заказчика.

   Логи:        journalctl -u ${SERVICE} -f
   Настройки:   ${ENV_FILE} (после правки: systemctl restart ${SERVICE})
   Данные/фото: ${DATA_DIR} — бэкапьте эту папку
   Обновление:  запустите эту же команду ещё раз
DONE
