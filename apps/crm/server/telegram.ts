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

export const sendMessage = async (
  chatId: number,
  text: string,
  appPath = ""
): Promise<void> => {
  if (!botEnabled()) {
    return;
  }
  try {
    await tg("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: openAppMarkup(appPath),
    });
  } catch (error) {
    // The user may have never started the bot or blocked it — not fatal.
    process.stderr.write(`notify ${chatId} failed: ${String(error)}\n`);
  }
};

/** Sends the same message to several users, skipping the actor. */
export const notify = async (
  userIds: Iterable<number | null | undefined>,
  exceptId: number,
  text: string,
  appPath = ""
): Promise<void> => {
  const targets = new Set<number>();
  for (const id of userIds) {
    if (id && id !== exceptId) {
      targets.add(id);
    }
  }
  await Promise.all([...targets].map((id) => sendMessage(id, text, appPath)));
};
