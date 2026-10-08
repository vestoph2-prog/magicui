import { randomBytes } from "node:crypto";
import {
  displayName,
  isStaff,
  PRIORITY_LABELS,
  ROLE_LABELS,
  type Role,
  STATUS_LABELS,
  type Task,
  type TaskPatch,
  type User,
} from "../shared/model.ts";
import {
  createInvite,
  getUser,
  logActivity,
  memberIds,
  redeemInvite,
  setUserRole,
} from "./db.ts";
import { html, notify, startLink } from "./telegram.ts";

const INVITE_PREFIX = "inv_";

export const makeInvite = async (role: Role, createdBy: number) => {
  const code = randomBytes(9).toString("base64url");
  createInvite(code, role, createdBy);
  return { code, role, link: await startLink(`${INVITE_PREFIX}${code}`) };
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
  if (!invite) {
    return user;
  }
  const rank: Record<Role, number> = {
    guest: 0,
    client: 1,
    manager: 2,
    admin: 3,
  };
  if (rank[invite.role] > rank[user.role]) {
    setUserRole(user.id, invite.role);
    notify(
      memberIds(),
      user.id,
      html`👤 <b>${displayName(user)}</b> присоединился как ${ROLE_LABELS[invite.role]}`
    ).catch(() => null);
  }
  return getUser(user.id) ?? user;
};

const taskLine = (task: Task) =>
  html`<b>#${task.id} ${task.title}</b>\n🏗 ${task.objectName} · ${task.dealTitle}`;

const taskPath = (task: Task) => `#/tasks/${task.id}`;

const byline = (actor: User) => html`👤 ${displayName(actor)}`;

export const onTaskCreated = async (task: Task, actor: User) => {
  logActivity(task.id, actor.id, "создал(а) задачу");
  const header = isStaff(actor.role)
    ? "🆕 Новая задача"
    : "🆕 Новая задача от заказчика";
  const assignee = task.assigneeName
    ? html`\n➡️ Исполнитель: ${task.assigneeName}`
    : "";
  await notify(
    memberIds(),
    actor.id,
    `${header}\n${taskLine(task)}${assignee}\n${byline(actor)}`,
    taskPath(task)
  );
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
  if (changed(before, patch, "dueDate")) {
    changes.push(`срок: ${patch.dueDate ?? "без срока"}`);
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
  await notify(
    memberIds(),
    actor.id,
    `✏️ ${taskLine(task)}\n${lines}\n${byline(actor)}`,
    taskPath(task)
  );
};

export const onComment = async (task: Task, actor: User, body: string) => {
  const preview = body.length > 300 ? `${body.slice(0, 300)}…` : body;
  await notify(
    memberIds(),
    actor.id,
    `💬 ${taskLine(task)}\n${html`<b>${displayName(actor)}:</b> ${preview}`}`,
    taskPath(task)
  );
};
