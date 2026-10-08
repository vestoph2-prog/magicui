import { displayName, isStaff, ROLE_LABELS } from "../shared/model.ts";
import { config } from "./config.ts";
import { upsertUser } from "./db.ts";
import { applyStartParam } from "./service.ts";
import { botEnabled, html, sendMessage, tg } from "./telegram.ts";

type Update = {
  update_id: number;
  message?: {
    chat: { id: number; type: string };
    from?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    text?: string;
  };
};

const START_RE = /^\/start(?:@\w+)?(?:\s+(\S+))?/;

const handleUpdate = async (update: Update) => {
  const msg = update.message;
  if (!(msg?.from && msg.text && msg.chat.type === "private")) {
    return;
  }
  const start = START_RE.exec(msg.text);
  if (!start) {
    await sendMessage(msg.chat.id, "Откройте CRM кнопкой ниже 👇");
    return;
  }
  const user = applyStartParam(start[1], upsertUser(msg.from));
  const greeting =
    user.role === "guest"
      ? html`Привет, ${displayName(user)}! Доступа пока нет — попросите у менеджера ссылку-приглашение.`
      : html`Привет, ${displayName(user)}! Ваша роль: <b>${ROLE_LABELS[user.role]}</b>.`;
  const hint = isStaff(user.role)
    ? "\n\nЗдесь будут приходить уведомления о задачах, статусах и комментариях."
    : "";
  await sendMessage(msg.chat.id, `${greeting}${hint}`);
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
