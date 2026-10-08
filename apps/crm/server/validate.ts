import {
  isStaff,
  type Task,
  type TaskPatch,
  type TaskStatus,
  type User,
} from "../shared/model.ts";
import { type Ctx, HttpError } from "./http.ts";
import { getUser } from "./repo.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------- validation ------------------------------- */

export type Body = Record<string, unknown>;

export const bodyOf = (ctx: Ctx): Body =>
  ctx.body && typeof ctx.body === "object" ? (ctx.body as Body) : {};

const has = (b: Body, key: string) => Object.hasOwn(b, key);

export const str = (b: Body, key: string, max = 2000): string | undefined => {
  if (!has(b, key) || b[key] === null) {
    return;
  }
  if (typeof b[key] !== "string") {
    throw new HttpError(400, `Поле ${key} должно быть строкой`);
  }
  return (b[key] as string).trim().slice(0, max);
};

export const requiredStr = (b: Body, key: string, max = 200): string => {
  const value = str(b, key, max);
  if (!value) {
    throw new HttpError(400, `Заполните поле ${key}`);
  }
  return value;
};

export const num = (b: Body, key: string): number | undefined => {
  if (!has(b, key) || b[key] === null || b[key] === "") {
    return;
  }
  const value = Number(b[key]);
  if (!Number.isFinite(value)) {
    throw new HttpError(400, `Поле ${key} должно быть числом`);
  }
  return value;
};

export const oneOf = <T extends string>(
  b: Body,
  key: string,
  values: readonly T[]
): T | undefined => {
  if (!has(b, key) || b[key] === null) {
    return;
  }
  if (!values.includes(b[key] as T)) {
    throw new HttpError(400, `Недопустимое значение ${key}`);
  }
  return b[key] as T;
};

/** `undefined` = not sent, `null` = cleared. */
export const nullableDate = (
  b: Body,
  key: string
): string | null | undefined => {
  if (!has(b, key)) {
    return;
  }
  if (b[key] === null || b[key] === "") {
    return null;
  }
  if (typeof b[key] !== "string" || !DATE_RE.test(b[key] as string)) {
    throw new HttpError(400, "Дата в формате ГГГГ-ММ-ДД");
  }
  return b[key] as string;
};

export const nullableUser = (
  b: Body,
  key: string
): number | null | undefined => {
  if (!has(b, key)) {
    return;
  }
  if (b[key] === null || b[key] === "") {
    return null;
  }
  const id = Number(b[key]);
  const user = getUser(id);
  if (!user || user.role === "guest") {
    throw new HttpError(400, "Пользователь не найден");
  }
  return id;
};

export const idParam = (ctx: Ctx, key = "id"): number => {
  const id = Number(ctx.params[key]);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, "Некорректный id");
  }
  return id;
};

export const queryNum = (ctx: Ctx, key: string): number | undefined => {
  const raw = ctx.url.searchParams.get(key);
  return raw ? Number(raw) : undefined;
};

/* ------------------------------- permissions ------------------------------ */

export const requireMember = (user: User) => {
  if (user.role === "guest") {
    throw new HttpError(403, "Нет доступа. Попросите приглашение у менеджера.");
  }
};

export const requireStaff = (user: User) => {
  if (!isStaff(user.role)) {
    throw new HttpError(403, "Доступно только менеджерам");
  }
};

export const requireAdmin = (user: User) => {
  if (user.role !== "admin") {
    throw new HttpError(403, "Доступно только администратору");
  }
};

export const found = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) {
    throw new HttpError(404, `${what} не найден(а)`);
  }
  return value;
};

/** What the customer may do with statuses: accept, return, or cancel own task. */
const clientStatusAllowed = (task: Task, next: TaskStatus, user: User) => {
  if (task.status === "review") {
    return next === "done" || next === "in_progress";
  }
  return next === "canceled" && task.createdBy === user.id;
};

export const checkClientPatch = (task: Task, patch: TaskPatch, user: User) => {
  if (patch.status && !clientStatusAllowed(task, patch.status, user)) {
    throw new HttpError(
      403,
      "Заказчик может принять работу, вернуть её или отменить свою задачу"
    );
  }
  if (patch.assigneeId !== undefined) {
    throw new HttpError(403, "Исполнителя назначает менеджер");
  }
  const editsContent =
    patch.title !== undefined ||
    patch.kind !== undefined ||
    patch.description !== undefined ||
    patch.priority !== undefined ||
    patch.dueDate !== undefined;
  if (editsContent && task.createdBy !== user.id) {
    throw new HttpError(403, "Можно редактировать только свои задачи");
  }
};
