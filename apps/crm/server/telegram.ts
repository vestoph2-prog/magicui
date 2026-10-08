import { readFile } from "node:fs/promises";
import { config } from "./config.ts";

const API = "https://api.telegram.org";

type TgResponse<T> = { ok: boolean; result: T; description?: string };

export const tg = async <T>(
  method: string,
  body: Record<string, unknown> = {}
): Promise<T> => {
  const res = await fetch(`${API}/bot${config.botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as TgResponse<T>;
  if (!data.ok) {
    throw new Error(`Telegram ${method}: ${data.description ?? res.status}`);
  }
  return data.result;
};

export const botEnabled = (): boolean => config.botToken.length > 0;

let botUsername = "";

export const getBotUsername = async (): Promise<string> => {
  if (!(botUsername || botEnabled())) {
    return "";
  }
  if (!botUsername) {
    const me = await tg<{ username: string }>("getMe");
    botUsername = me.username;
  }
  return botUsername;
};

/** Deep link that opens the Mini App with a start parameter. */
export const startLink = async (param: string): Promise<string> => {
  const username = await getBotUsername();
  if (!username) {
    return `${config.webAppUrl || ""}?startapp=${param}`;
  }
  if (config.appShortName) {
    return `https://t.me/${username}/${config.appShortName}?startapp=${param}`;
  }
  return `https://t.me/${username}?start=${param}`;
};

const escapeHtml = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export const html = (
  strings: TemplateStringsArray,
  ...values: (string | number)[]
): string =>
  strings.reduce(
    (out, str, i) =>
      out + str + (i < values.length ? escapeHtml(String(values[i])) : ""),
    ""
  );

const openAppMarkup = (path = "") =>
  config.webAppUrl
    ? {
        inline_keyboard: [
          [
            {
              text: "Открыть CRM",
              web_app: { url: `${config.webAppUrl}${path}` },
            },
          ],
        ],
      }
    : undefined;

export type Outgoing = {
  text: string;
  /** Hash route inside the Mini App, e.g. `#/tasks/5`. */
  appPath?: string;
  /** Local photo file to attach. */
  photoPath?: string;
};

const CAPTION_LIMIT = 1024;

const sendPhoto = async (chatId: number, msg: Outgoing, photoPath: string) => {
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("caption", msg.text.slice(0, CAPTION_LIMIT));
  form.set("parse_mode", "HTML");
  const markup = openAppMarkup(msg.appPath);
  if (markup) {
    form.set("reply_markup", JSON.stringify(markup));
  }
  form.set("photo", new Blob([await readFile(photoPath)]), "photo.jpg");
  const res = await fetch(`${API}/bot${config.botToken}/sendPhoto`, {
    method: "POST",
    body: form,
  });
  const data = (await res.json()) as TgResponse<{ message_id: number }>;
  if (!data.ok) {
    throw new Error(`Telegram sendPhoto: ${data.description ?? res.status}`);
  }
  return data.result;
};

/** Returns the Telegram message id, or null when delivery failed. */
export const sendMessage = async (
  chatId: number,
  msg: Outgoing
): Promise<number | null> => {
  if (!botEnabled()) {
    return null;
  }
  try {
    const sent = msg.photoPath
      ? await sendPhoto(chatId, msg, msg.photoPath)
      : await tg<{ message_id: number }>("sendMessage", {
          chat_id: chatId,
          text: msg.text,
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          reply_markup: openAppMarkup(msg.appPath),
        });
    return sent.message_id;
  } catch (error) {
    // The user may have never started the bot or blocked it — not fatal.
    process.stderr.write(`notify ${chatId} failed: ${String(error)}\n`);
    return null;
  }
};

export type Delivered = { chatId: number; messageId: number };

/** Sends the same message to several users (private chat id = user id). */
export const notify = async (
  userIds: Iterable<number>,
  msg: Outgoing
): Promise<Delivered[]> => {
  const targets = [...new Set(userIds)];
  const results = await Promise.all(
    targets.map(async (chatId) => {
      const messageId = await sendMessage(chatId, msg);
      return messageId ? { chatId, messageId } : null;
    })
  );
  return results.filter((r): r is Delivered => r !== null);
};

export const downloadFile = async (fileId: string): Promise<Buffer> => {
  const file = await tg<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!file.file_path) {
    throw new Error("Telegram file has no path");
  }
  const res = await fetch(
    `${API}/file/bot${config.botToken}/${file.file_path}`
  );
  if (!res.ok) {
    throw new Error(`Telegram file download failed: ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
};
