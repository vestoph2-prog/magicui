#!/usr/bin/env bash
# Установка / обновление СетьПро CRM на VPS (Ubuntu) за существующим nginx:
#   https://app.сетьпро.рф/crm/
# Запуск (от root):
#   curl -fsSL https://raw.githubusercontent.com/vestoph2-prog/magicui/claude/telegram-crm-deals-l1md34/apps/crm/deploy/install.sh | sudo bash
# Повторный запуск = обновление. Данные, фото и токен сохраняются.
set -euo pipefail

DOMAIN="${DOMAIN:-app.xn--e1ascech4e.xn--p1ai}"   # app.сетьпро.рф (punycode)
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
CLI=/usr/local/bin/setpro-crm

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
fail() { printf '\n\033[31m❌ %s\033[0m\n' "$*" >&2; exit 1; }

tg_get_me() { curl -fsS --max-time 15 "https://api.telegram.org/bot$1/getMe" 2>/dev/null || true; }

# ------------------------------------------------------------------ preflight
say "Проверки"
[ "$(id -u)" -eq 0 ] || fail "Запустите от root: … | sudo bash"
command -v nginx >/dev/null || fail "nginx не найден."
command -v systemctl >/dev/null || fail "Нужен systemd."
ok "root, nginx, systemd"

if ss -ltn "( sport = :${PORT} )" 2>/dev/null | grep -q LISTEN &&
  ! systemctl is-active -q "$SERVICE" 2>/dev/null; then
  fail "Порт ${PORT} занят другой программой. Запустите с PORT=3200 (или другим свободным)."
fi
ok "порт ${PORT} свободен"

curl -fsS --max-time 15 -o /dev/null "https://api.telegram.org" ||
  warn "Нет связи с api.telegram.org — бот не сможет работать, проверьте сеть/фаервол."

# ------------------------------------------------------------------ token
if [ -f "$ENV_FILE" ]; then
  ok "настройки уже есть: $ENV_FILE (обновление)"
else
  say "Настройка бота"
  while :; do
    read -rp "  Токен бота от @BotFather: " token </dev/tty
    token="$(echo "$token" | tr -d '[:space:]')"
    me="$(tg_get_me "$token")"
    if echo "$me" | grep -q '"ok":true'; then
      ok "бот @$(echo "$me" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p') найден"
      break
    fi
    warn "Telegram не принял токен, попробуйте ещё раз."
  done
  read -rp "  Ваш Telegram ID для роли администратора (Enter — пропустить, админом станет первый вошедший): " admin_id </dev/tty
  umask 077
  cat >"$ENV_FILE" <<ENV
BOT_TOKEN=${token}
WEBAPP_URL=https://${DOMAIN}${BASE_PATH}/
ADMIN_IDS=${admin_id}
HOST=127.0.0.1
PORT=${PORT}
DB_PATH=${DATA_DIR}/crm.db
TZ_NAME=Europe/Moscow
DIGEST_HOUR=8
ENV
  umask 022
  ok "сохранено в $ENV_FILE (доступ только root)"
fi

# ------------------------------------------------------------------ node + code
if ! command -v node >/dev/null ||
  ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'; then
  say "Устанавливаю Node.js 22"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg git >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
command -v git >/dev/null || apt-get install -y -qq git >/dev/null
ok "node $(node -v)"

say "Загружаю код"
if [ -d "$SRC_DIR/.git" ]; then
  git -C "$SRC_DIR" fetch -q --depth 1 origin "$BRANCH"
  git -C "$SRC_DIR" reset -q --hard FETCH_HEAD
else
  git clone -q --depth 1 -b "$BRANCH" "$REPO" "$SRC_DIR"
fi
ok "версия $(git -C "$SRC_DIR" rev-parse --short HEAD)"

say "Собираю"
cd "$APP_DIR"
npm install --no-audit --no-fund --loglevel=error
npx vite build --logLevel error
ok "интерфейс собран"

id -u setpro-crm >/dev/null 2>&1 ||
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin setpro-crm
mkdir -p "$DATA_DIR"
chown -R setpro-crm:setpro-crm "$DATA_DIR"

if [ -f "$DATA_DIR/crm.db" ]; then
  say "Бэкап перед обновлением"
  set -a; . "$ENV_FILE"; set +a
  runuser -u setpro-crm -- env $(grep -v '^#' "$ENV_FILE" | xargs) \
    node --disable-warning=ExperimentalWarning server/backup.ts | sed 's/^/  /'
fi

# ------------------------------------------------------------------ service
say "Сервис"
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
ok "setpro-crm запущен"

# ------------------------------------------------------------------ nginx
say "nginx: ${BASE_PATH}/ → CRM"
mkdir -p "$(dirname "$SNIPPET")"
cat >"$SNIPPET" <<NGINX
# СетьПро CRM — подключается в server { } для ${DOMAIN}
location = ${BASE_PATH} { return 301 ${BASE_PATH}/; }
# ^~ — чтобы правила вида location ~* \.(js|css|jpg)$ не перехватывали файлы CRM
location ^~ ${BASE_PATH}/ {
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

CONF="$(grep -RlE "server_name[^;]*${DOMAIN//./\\.}" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | head -n1 || true)"
[ -n "$CONF" ] || fail "Не нашёл server { } с server_name ${DOMAIN} в nginx. Добавьте в него строку: include ${SNIPPET};  и выполните: nginx -t && systemctl reload nginx"
CONF="$(readlink -f "$CONF")"
if grep -q "include ${SNIPPET};" "$CONF"; then
  ok "уже подключено в $CONF"
else
  cp "$CONF" "${CONF}.bak-setpro-crm"
  sed -i -E "/server_name[^;]*${DOMAIN//./\\.}/a\\    include ${SNIPPET};" "$CONF"
  ok "подключено в $CONF (бэкап: ${CONF}.bak-setpro-crm)"
fi
if ! nginx -t 2>/tmp/setpro-nginx.log; then
  [ -f "${CONF}.bak-setpro-crm" ] && cp "${CONF}.bak-setpro-crm" "$CONF"
  cat /tmp/setpro-nginx.log >&2
  fail "nginx -t не прошёл — конфиг восстановлен, сайт не затронут."
fi
systemctl reload nginx
ok "nginx перезагружен"

# ------------------------------------------------------------------ cli
cat >"$CLI" <<'CLI'
#!/usr/bin/env bash
# setpro-crm status|logs|restart|update|backup
set -euo pipefail
case "${1:-status}" in
  status)
    systemctl --no-pager --lines=0 status setpro-crm || true
    . /etc/setpro-crm.env
    echo; curl -fsS "http://127.0.0.1:${PORT}/api/health" && echo ;;
  logs) journalctl -u setpro-crm -f -n 100 ;;
  restart) systemctl restart setpro-crm && echo "перезапущено" ;;
  update)
    curl -fsSL https://raw.githubusercontent.com/vestoph2-prog/magicui/claude/telegram-crm-deals-l1md34/apps/crm/deploy/install.sh | bash ;;
  backup)
    cd /opt/setpro-crm/apps/crm
    runuser -u setpro-crm -- env $(grep -v '^#' /etc/setpro-crm.env | xargs) \
      node --disable-warning=ExperimentalWarning server/backup.ts ;;
  *) echo "использование: setpro-crm status|logs|restart|update|backup" ;;
esac
CLI
chmod 755 "$CLI"

# ------------------------------------------------------------------ verify
say "Проверка"
health=""
for _ in $(seq 1 30); do
  health="$(curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/api/health" 2>/dev/null || true)"
  echo "$health" | grep -q '"app":"setpro-crm"' && break
  sleep 1
done
echo "$health" | grep -q '"app":"setpro-crm"' || {
  journalctl -u "$SERVICE" -n 40 --no-pager >&2
  fail "Сервис не отвечает — лог выше."
}
ok "сервис отвечает"

public="$(curl -fsS --max-time 15 "https://${DOMAIN}${BASE_PATH}/api/health" 2>/dev/null || true)"
if echo "$public" | grep -q '"app":"setpro-crm"'; then
  ok "https://app.сетьпро.рф${BASE_PATH}/ ведёт в CRM"
else
  warn "Снаружи ${BASE_PATH}/ отвечает не CRM. Проверьте, что include стоит в блоке 'listen 443' для ${DOMAIN}: grep -n setpro-crm $CONF"
fi
if echo "$health" | grep -q '"bot":"@'; then
  ok "бот $(echo "$health" | sed -n 's/.*"bot":"\([^"]*\)".*/\1/p') подключён"
else
  warn "бот не отвечает — проверьте BOT_TOKEN в $ENV_FILE и выполните: setpro-crm restart"
fi

cat <<DONE

✅ Готово: https://app.сетьпро.рф${BASE_PATH}/

  1. Откройте бота в Telegram → /start → кнопка «CRM» внизу слева.
  2. «Команда» → «Создать ссылку» → отправьте менеджеру и заказчику.

  setpro-crm status   — состояние      setpro-crm logs    — логи
  setpro-crm update   — обновить        setpro-crm backup  — бэкап сейчас
  Данные и фото: ${DATA_DIR} (бэкапы базы — каждую ночь, 14 дней)
DONE
