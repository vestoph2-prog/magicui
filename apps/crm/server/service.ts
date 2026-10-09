import { randomBytes } from "node:crypto";
import {
  type Deal,
  displayName,
  isStaff,
  KIND_LABELS,
  type Message,
  PRIORITY_LABELS,
  ROLE_LABELS,
  type Role,
  STATUS_LABELS,
  TASK_TEMPLATES,
  type Task,
  type TaskPatch,
  type User,
} from "../shared/model.ts";
import {
  addMessage,
  getMessage,
  linkTelegramMessage,
  logActivity,
} from "./chat-repo.ts";
import { config } from "./config.ts";
import {
  createInvite,
  createTask,
  getUser,
  listTasks,
  memberIds,
  redeemInvite,
  setUserRole,
  touchTask,
} from "./repo.ts";
import { html, notify, type Outgoing, startLink } from "./telegram.ts";
import { formatLocal } from "./time.ts";
import { uploadPath } from "./uploads.ts";

/* --------------------------------- invites -------------------------------- */

const INVITE_PREFIX = "inv_";

export const makeInvite = async (role: Role, createdBy: number) => {
  const code = randomBytes(9).toString("base64url");
  createInvite(code, role, createdBy);
  return { code, role, link: await startLink(`${INVITE_PREFIX}${code}`) };
};

const ROLE_RANK: Record<Role, number> = {
  guest: 0,
  client: 1,
  manager: 2,
  admin: 3,
};

/**
 * Applies an invite from a start parameter. Never downgrades: an admin who
 * opens a client link stays admin.
 */
export const applyStartParam = (
  param: string | null | undefined,
  user: User
): User => {
  if (!param?.startsWith(INVITE_PREFIX)) {
    return user;
  }
  const invite = redeemInvite(param.slice(INVITE_PREFIX.length), user.id);
  if (!(invite && ROLE_RANK[invite.role] > ROLE_RANK[user.role])) {
    return user;
  }
  setUserRole(user.id, invite.role);
  notify(
    memberIds().filter((id) => id !== user.id),
    {
      text: html`👤 <b>${displayName(user)}</b> присоединился как ${ROLE_LABELS[invite.role]}`,
    }
  ).catch(() => null);
  return getUser(user.id) ?? user;
};

/* -------------------------------- presence -------------------------------- */

const PRESENCE_TTL_MS = 12_000;
const presence = new Map<string, number>();

/** Called on every chat poll: the user is looking at this task right now. */
export const touchPresence = (taskId: number, userId: number): void => {
  presence.set(`${taskId}:${userId}`, Date.now());
};

const isWatching = (taskId: number, userId: number): boolean =>
  Date.now() - (presence.get(`${taskId}:${userId}`) ?? 0) < PRESENCE_TTL_MS;

/* ------------------------------ notifications ----------------------------- */

const REPLY_HINT =
  "\n\n<i>↩️ Ответьте на это сообщение — ответ попадёт в чат задачи</i>";

const taskHeader = (task: Task) =>
  html`<b>#${task.id} ${task.title}</b>\n🏗 ${task.objectName} · ${task.dealTitle}`;

/**
 * Notifies everyone except the actor and people who have this chat open,
 * and remembers the bot messages so Telegram replies land in the task chat.
 */
export const notifyTask = async (
  task: Task,
  actorId: number,
  msg: Outgoing
) => {
  const recipients = memberIds().filter(
    (id) => id !== actorId && !isWatching(task.id, id)
  );
  const delivered = await notify(recipients, {
    appPath: `#/tasks/${task.id}`,
    ...msg,
    text: `${msg.text}${REPLY_HINT}`,
  });
  for (const d of delivered) {
    linkTelegramMessage(d.chatId, d.messageId, task.id);
  }
};

export const onTaskCreated = async (task: Task, actor: User) => {
  logActivity(task.id, actor.id, "создал(а) задачу");
  const header = isStaff(actor.role)
    ? "🆕 Новая задача"
    : "🆕 Новая заявка от заказчика";
  const lines = [
    `${header} · ${KIND_LABELS[task.kind]}`,
    taskHeader(task),
    task.description ? html`\n${task.description.slice(0, 500)}` : "",
    task.assigneeName ? html`➡️ Исполнитель: ${task.assigneeName}` : "",
    html`👤 ${displayName(actor)}`,
  ];
  await notifyTask(task, actor.id, {
    text: lines.filter(Boolean).join("\n"),
  });
};

const changed = <K extends keyof TaskPatch>(
  before: Task,
  patch: TaskPatch,
  key: K
): boolean => patch[key] !== undefined && patch[key] !== before[key];

const assigneeLabel = (id: number | null | undefined): string => {
  const assignee = id ? getUser(id) : undefined;
  return assignee ? displayName(assignee) : "не назначен";
};

export const describeChanges = (before: Task, patch: TaskPatch): string[] => {
  const changes: string[] = [];
  if (patch.status && changed(before, patch, "status")) {
    changes.push(
      `статус: ${STATUS_LABELS[before.status]} → ${STATUS_LABELS[patch.status]}`
    );
  }
  if (patch.priority && changed(before, patch, "priority")) {
    changes.push(`приоритет: ${PRIORITY_LABELS[patch.priority]}`);
  }
  if (patch.kind && changed(before, patch, "kind")) {
    changes.push(`тип: ${KIND_LABELS[patch.kind]}`);
  }
  if (changed(before, patch, "dueDate")) {
    changes.push(`срок: ${patch.dueDate ?? "без срока"}`);
  }
  if (changed(before, patch, "visitAt")) {
    changes.push(
      patch.visitAt
        ? `🚗 выезд: ${formatLocal(patch.visitAt, config.timeZone)}`
        : "выезд отменён"
    );
  }
  if (changed(before, patch, "assigneeId")) {
    changes.push(`исполнитель: ${assigneeLabel(patch.assigneeId)}`);
  }
  if (changed(before, patch, "title")) {
    changes.push("изменено название");
  }
  if (changed(before, patch, "description")) {
    changes.push("изменено описание");
  }
  return changes;
};

export const onTaskUpdated = async (
  task: Task,
  changes: string[],
  actor: User
) => {
  if (!changes.length) {
    return;
  }
  for (const change of changes) {
    logActivity(task.id, actor.id, change);
  }
  const lines = changes.map((c) => html`• ${c}`).join("\n");
  await notifyTask(task, actor.id, {
    text: `✏️ ${taskHeader(task)}\n${lines}\n${html`👤 ${displayName(actor)}`}`,
  });
};

/* ---------------------------------- chat ---------------------------------- */

export type ChatInput = {
  body: string;
  attachments?: string[];
  replyTo?: number | null;
  source?: "app" | "telegram";
};

const MESSAGE_PREVIEW = 700;

/** Telegram shows one photo with the button; the rest are in the app. */
const photosNote = (count: number): string =>
  count > 1 ? `\n📷 +${count - 1} фото — смотрите в CRM` : "";

/** Posts into a task chat from the app or from a Telegram reply. */
export const postMessage = async (
  task: Task,
  actor: User,
  input: ChatInput
): Promise<Message> => {
  const photos = input.attachments ?? [];
  const reply = input.replyTo ? getMessage(input.replyTo) : undefined;
  const id = addMessage({
    taskId: task.id,
    authorId: actor.id,
    body: input.body,
    attachments: input.attachments,
    replyTo: reply?.taskId === task.id ? reply.id : null,
    source: input.source,
  });
  touchTask(task.id);
  const message = getMessage(id);
  if (!message) {
    throw new Error("Message was not saved");
  }
  const body =
    input.body.length > MESSAGE_PREVIEW
      ? `${input.body.slice(0, MESSAGE_PREVIEW)}…`
      : input.body;
  const quote = message.replyBody
    ? html`\n<blockquote>${message.replyAuthor ?? ""}: ${message.replyBody}</blockquote>`
    : "";
  await notifyTask(task, actor.id, {
    text: `💬 ${taskHeader(task)}${quote}\n${html`<b>${displayName(actor)}:</b> ${body || "📷 Фото"}`}${photosNote(photos.length)}`,
    photoPath: photos[0] ? uploadPath(photos[0]) : undefined,
  });
  return message;
};

/* -------------------------------- templates ------------------------------- */

/** Creates the standard work breakdown for the deal's service, skipping dupes. */
export const applyTemplate = (deal: Deal, actor: User): number => {
  const existing = new Set(
    listTasks({ dealId: deal.id }, actor.id).map((t) => t.title)
  );
  let created = 0;
  for (const tpl of TASK_TEMPLATES[deal.service]) {
    if (!existing.has(tpl.title)) {
      const id = createTask(
        {
          dealId: deal.id,
          kind: tpl.kind,
          title: tpl.title,
          checklist: tpl.checklist,
        },
        actor.id
      );
      logActivity(id, actor.id, "создал(а) задачу из шаблона");
      created += 1;
    }
  }
  return created;
};
