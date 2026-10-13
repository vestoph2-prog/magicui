import { displayName, isStaff, ROLE_LABELS } from "../shared/model.ts";
import {
  appendAttachment,
  getMessage,
  taskForTelegramMessage,
} from "./chat-repo.ts";
import { config } from "./config.ts";
import {
  getTask,
  getUser,
  type TelegramProfile,
  touchTask,
  upsertUser,
} from "./repo.ts";
import { applyStartParam, postMessage } from "./service.ts";
import { botEnabled, downloadFile, html, sendMessage, tg } from "./telegram.ts";
import { MAX_UPLOAD_BYTES, saveImage } from "./uploads.ts";

type TgMessage = {
  message_id: number;
  chat: { id: number; type: string };
  from?: TelegramProfile;
  text?: string;
  caption?: string;
  photo?: { file_id: string; file_size?: number }[];
  /** "Send as file" keeps full quality; we accept it if it's an image. */
  document?: { file_id: string; mime_type?: string; file_size?: number };
  media_group_id?: string;
  reply_to_message?: { message_id: number };
};

type Update = { update_id: number; message?: TgMessage };

const START_RE = /^\/start(?:@\w+)?(?:\s+(\S+))?/;

const react = (msg: TgMessage, emoji: string) =>
  tg("setMessageReaction", {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    reaction: [{ type: "emoji", emoji }],
  }).catch(() => null);

const imageFileId = (msg: TgMessage): string | undefined => {
  // Telegram lists sizes ascending; take the biggest that fits our limit.
  const photo = msg.photo
    ?.filter((p) => (p.file_size ?? 0) <= MAX_UPLOAD_BYTES)
    .at(-1);
  if (photo) {
    return photo.file_id;
  }
  const doc = msg.document;
  const isImage = doc?.mime_type?.startsWith("image/") ?? false;
  return isImage && (doc?.file_size ?? 0) <= MAX_UPLOAD_BYTES
    ? doc?.file_id
    : undefined;
};

const savePhoto = async (msg: TgMessage): Promise<string | null> => {
  const fileId = imageFileId(msg);
  return fileId ? saveImage(await downloadFile(fileId)) : null;
};

const ALBUM_TTL_MS = 60_000;

/** Album id → chat message it was saved into, so later photos join it. */
const albums = new Map<string, { messageId: number; at: number }>();

const rememberAlbum = (groupId: string | undefined, messageId: number) => {
  const now = Date.now();
  for (const [key, value] of albums) {
    if (now - value.at > ALBUM_TTL_MS) {
      albums.delete(key);
    }
  }
  if (groupId) {
    albums.set(groupId, { messageId, at: now });
  }
};

/** Second and later photos of an album go into the same chat message. */
const handleAlbumPart = async (msg: TgMessage): Promise<boolean> => {
  const album = msg.media_group_id ? albums.get(msg.media_group_id) : undefined;
  if (!album) {
    return false;
  }
  const file = await savePhoto(msg);
  if (file) {
    appendAttachment(album.messageId, file);
    const message = getMessage(album.messageId);
    if (message) {
      touchTask(message.taskId);
    }
  }
  return true;
};

/** A reply to a bot notification → message in that task's chat. */
const handleReply = async (msg: TgMessage, replyToId: number) => {
  const taskId = taskForTelegramMessage(msg.chat.id, replyToId);
  const user = msg.from ? getUser(msg.from.id) : undefined;
  if (!(taskId && user) || user.role === "guest") {
    await sendMessage(msg.chat.id, {
      text: "Не нашёл задачу для этого ответа. Откройте чат задачи в CRM 👇",
    });
    return;
  }
  const task = getTask(taskId, user.id);
  if (!task) {
    await sendMessage(msg.chat.id, { text: "Задача уже удалена." });
    return;
  }
  const photo = await savePhoto(msg);
  const body = (msg.text ?? msg.caption ?? "").trim().slice(0, 4000);
  if (!(body || photo)) {
    await sendMessage(msg.chat.id, {
      text: "В чат задачи можно отправить текст или фото.",
    });
    return;
  }
  const message = await postMessage(task, user, {
    body,
    attachments: photo ? [photo] : [],
    source: "telegram",
  });
  rememberAlbum(msg.media_group_id, message.id);
  await react(msg, "👍");
};

const handleStart = async (msg: TgMessage, param: string | undefined) => {
  if (!msg.from) {
    return;
  }
  const user = applyStartParam(param, upsertUser(msg.from));
  const greeting =
    user.role === "guest"
      ? html`Привет, ${displayName(user)}! Доступа пока нет — попросите у менеджера ссылку-приглашение.`
      : html`Привет, ${displayName(user)}! Ваша роль: <b>${ROLE_LABELS[user.role]}</b>.`;
  const hint =
    user.role === "guest"
      ? ""
      : "\n\nСюда будут приходить новые задачи, смены статусов и сообщения из чатов задач. " +
        "Чтобы ответить в чат задачи, просто ответьте (reply) на уведомление.";
  const staffHint = isStaff(user.role)
    ? "\nЗаявки заказчика по интернету и видеонаблюдению — во вкладке «Задачи»."
    : "";
  await sendMessage(msg.chat.id, {
    text: `${greeting}${hint}${user.role === "guest" ? "" : staffHint}`,
  });
};

const handleUpdate = async (update: Update) => {
  const msg = update.message;
  if (!(msg?.from && msg.chat.type === "private")) {
    return;
  }
  const start = msg.text ? START_RE.exec(msg.text) : null;
  if (start) {
    await handleStart(msg, start[1]);
    return;
  }
  if (await handleAlbumPart(msg)) {
    return;
  }
  if (msg.reply_to_message) {
    await handleReply(msg, msg.reply_to_message.message_id);
    return;
  }
  await sendMessage(msg.chat.id, {
    text: "Откройте CRM кнопкой ниже 👇\nЧтобы написать в чат задачи — ответьте (reply) на уведомление о ней.",
  });
};

const configureBot = async () => {
  await tg("setMyCommands", {
    commands: [{ command: "start", description: "Открыть CRM" }],
  });
  if (config.webAppUrl) {
    await tg("setChatMenuButton", {
      menu_button: {
        type: "web_app",
        text: "CRM",
        web_app: { url: config.webAppUrl },
      },
    });
  }
};

const pause = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const pollOnce = async (offset: number): Promise<number> => {
  let next = offset;
  try {
    const updates = await tg<Update[]>("getUpdates", {
      offset,
      timeout: 50,
      allowed_updates: ["message"],
    });
    for (const update of updates) {
      next = update.update_id + 1;
      await handleUpdate(update).catch((error: unknown) => {
        process.stderr.write(`bot update failed: ${String(error)}\n`);
      });
    }
  } catch (error) {
    process.stderr.write(`bot polling error: ${String(error)}\n`);
    await pause(5000);
  }
  return next;
};

const poll = async () => {
  let offset = 0;
  for (;;) {
    offset = await pollOnce(offset);
  }
};

export const startBot = async () => {
  if (!botEnabled()) {
    process.stdout.write("BOT_TOKEN не задан — бот и уведомления выключены\n");
    return;
  }
  await configureBot().catch((error: unknown) => {
    process.stderr.write(`bot setup failed: ${String(error)}\n`);
  });
  if (config.botPolling) {
    await tg("deleteWebhook").catch(() => null);
    poll().catch(() => null);
  }
};
