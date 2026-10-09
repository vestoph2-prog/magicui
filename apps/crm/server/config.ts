import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const ENV_FILE = resolve(ROOT, ".env");

if (existsSync(ENV_FILE)) {
  process.loadEnvFile(ENV_FILE);
}

const env = (name: string, fallback = ""): string =>
  process.env[name]?.trim() || fallback;

export const config = {
  root: ROOT,
  port: Number(env("PORT", "3000")),
  /** 127.0.0.1 behind nginx; 0.0.0.0 (default) in Docker. */
  host: env("HOST", "0.0.0.0"),
  dbPath:
    env("DB_PATH") === ":memory:"
      ? ":memory:"
      : resolve(ROOT, env("DB_PATH", "data/crm.db")),
  /** Time zone for the morning digest and "today" in reminders. */
  timeZone: env("TZ_NAME", "Europe/Moscow"),
  /** Local hour (0–23) to send the morning digest; empty disables it. */
  digestHour: env("DIGEST_HOUR", "8"),
  botToken: env("BOT_TOKEN"),
  /** Public HTTPS URL where this server is reachable (Mini App URL). */
  webAppUrl: env("WEBAPP_URL"),
  /** Short name of the Mini App registered in @BotFather (optional). */
  appShortName: env("APP_SHORT_NAME"),
  adminIds: env("ADMIN_IDS")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0),
  /** Lets you open the app in a normal browser as a fake user. Never in prod. */
  devAuth: env("DEV_AUTH") === "1",
  /** Max age of Telegram initData, seconds. */
  authMaxAge: Number(env("AUTH_MAX_AGE", "86400")),
  /** Poll Telegram for bot updates (/start, invites). */
  botPolling: env("BOT_POLLING", "1") === "1",
};
