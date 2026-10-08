import { createHmac, timingSafeEqual } from "node:crypto";
import type { TelegramProfile } from "./db.ts";

export type InitData = {
  user: TelegramProfile;
  startParam: string | null;
  authDate: number;
};

export class AuthError extends Error {}

const hmac = (key: string | Buffer, data: string): Buffer =>
  createHmac("sha256", key).update(data).digest();

/**
 * Validates Telegram Mini App initData.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export const validateInitData = (
  raw: string,
  botToken: string,
  maxAgeSeconds: number
): InitData => {
  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash) {
    throw new AuthError("initData has no hash");
  }
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = hmac("WebAppData", botToken);
  const expected = hmac(secret, dataCheckString);
  const actual = Buffer.from(hash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new AuthError("initData signature mismatch");
  }
  const authDate = Number(params.get("auth_date"));
  if (
    maxAgeSeconds > 0 &&
    (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds)
  ) {
    throw new AuthError("initData expired");
  }
  const userJson = params.get("user");
  if (!userJson) {
    throw new AuthError("initData has no user");
  }
  return {
    user: JSON.parse(userJson) as TelegramProfile,
    startParam: params.get("start_param"),
    authDate,
  };
};
