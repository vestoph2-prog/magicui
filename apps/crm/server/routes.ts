import {
  DEAL_STAGES,
  type DealInput,
  type DealStage,
  isStaff,
  type ObjectInput,
  PRIORITIES,
  type Priority,
  ROLES,
  type Role,
  TASK_STATUSES,
  type Task,
  type TaskInput,
  type TaskPatch,
  type TaskStatus,
  type User,
} from "../shared/model.ts";
import {
  addComment,
  createDeal,
  createObject,
  createTask,
  dashboard,
  deleteDeal,
  deleteObject,
  deleteTask,
  getDeal,
  getObject,
  getTask,
  getUser,
  listActivity,
  listComments,
  listDeals,
  listObjects,
  listTasks,
  listUsers,
  setUserRole,
  updateDeal,
  updateObject,
  updateTask,
} from "./db.ts";
import { type Ctx, createRouter, HttpError } from "./http.ts";
import {
  applyStartParam,
  describeChanges,
  makeInvite,
  onComment,
  onTaskCreated,
  onTaskUpdated,
} from "./service.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------- validation ------------------------------- */

type Body = Record<string, unknown>;

const bodyOf = (ctx: Ctx): Body =>
  ctx.body && typeof ctx.body === "object" ? (ctx.body as Body) : {};

const has = (b: Body, key: string) => Object.hasOwn(b, key);

const str = (b: Body, key: string, max = 2000): string | undefined => {
  if (!has(b, key) || b[key] === null) {
    return;
  }
  if (typeof b[key] !== "string") {
    throw new HttpError(400, `Поле ${key} должно быть строкой`);
  }
  return (b[key] as string).trim().slice(0, max);
};

const requiredStr = (b: Body, key: string, max = 200): string => {
  const value = str(b, key, max);
  if (!value) {
    throw new HttpError(400, `Заполните поле ${key}`);
  }
  return value;
};

const num = (b: Body, key: string): number | undefined => {
  if (!has(b, key) || b[key] === null || b[key] === "") {
    return;
  }
  const value = Number(b[key]);
  if (!Number.isFinite(value)) {
    throw new HttpError(400, `Поле ${key} должно быть числом`);
  }
  return value;
};

const oneOf = <T extends string>(
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
const nullableDate = (b: Body, key: string): string | null | undefined => {
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

const nullableUser = (b: Body, key: string): number | null | undefined => {
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

const idParam = (ctx: Ctx, key = "id"): number => {
  const id = Number(ctx.params[key]);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, "Некорректный id");
  }
  return id;
};

const queryNum = (ctx: Ctx, key: string): number | undefined => {
  const raw = ctx.url.searchParams.get(key);
  return raw ? Number(raw) : undefined;
};

/* ------------------------------- permissions ------------------------------ */

const requireMember = (user: User) => {
  if (user.role === "guest") {
    throw new HttpError(403, "Нет доступа. Попросите приглашение у менеджера.");
  }
};

const requireStaff = (user: User) => {
  if (!isStaff(user.role)) {
    throw new HttpError(403, "Доступно только менеджерам");
  }
};

const requireAdmin = (user: User) => {
  if (user.role !== "admin") {
    throw new HttpError(403, "Доступно только администратору");
  }
};

const found = <T>(value: T | undefined, what: string): T => {
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

const checkClientPatch = (task: Task, patch: TaskPatch, user: User) => {
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
    patch.description !== undefined ||
    patch.priority !== undefined ||
    patch.dueDate !== undefined;
  if (editsContent && task.createdBy !== user.id) {
    throw new HttpError(403, "Можно редактировать только свои задачи");
  }
};

/* --------------------------------- routes --------------------------------- */

export const router = createRouter();

router.get("/api/me", (ctx) => {
  const user = applyStartParam(ctx.startParam, ctx.user);
  return { user };
});

router.get("/api/dashboard", (ctx) => {
  requireMember(ctx.user);
  return dashboard(ctx.user);
});

router.get("/api/users", (ctx) => {
  requireMember(ctx.user);
  const users = listUsers();
  return isStaff(ctx.user.role)
    ? users
    : users.filter((u) => u.role !== "guest");
});

router.patch("/api/users/:id", (ctx) => {
  requireAdmin(ctx.user);
  const id = idParam(ctx);
  if (id === ctx.user.id) {
    throw new HttpError(400, "Нельзя менять собственную роль");
  }
  const role = oneOf<Role>(bodyOf(ctx), "role", ROLES);
  if (role) {
    setUserRole(found(getUser(id), "Пользователь").id, role);
  }
  return getUser(id);
});

router.post("/api/invites", async (ctx) => {
  requireStaff(ctx.user);
  const role = oneOf<Role>(bodyOf(ctx), "role", ROLES) ?? "client";
  if (role === "admin" || (role === "manager" && ctx.user.role !== "admin")) {
    throw new HttpError(403, "Недостаточно прав для такой роли");
  }
  return await makeInvite(role, ctx.user.id);
});

/* objects */

router.get("/api/objects", (ctx) => {
  requireMember(ctx.user);
  return listObjects();
});

router.get("/api/objects/:id", (ctx) => {
  requireMember(ctx.user);
  const object = found(getObject(idParam(ctx)), "Объект");
  return { object, deals: listDeals({ objectId: object.id }) };
});

router.post("/api/objects", (ctx) => {
  requireStaff(ctx.user);
  const b = bodyOf(ctx);
  const input: ObjectInput = {
    name: requiredStr(b, "name"),
    address: str(b, "address", 300),
    description: str(b, "description"),
  };
  return getObject(createObject(input));
});

router.patch("/api/objects/:id", (ctx) => {
  requireStaff(ctx.user);
  const id = found(getObject(idParam(ctx)), "Объект").id;
  const b = bodyOf(ctx);
  updateObject(id, {
    name: str(b, "name", 200) || undefined,
    address: str(b, "address", 300),
    description: str(b, "description"),
    archived: typeof b.archived === "boolean" ? b.archived : undefined,
  });
  return getObject(id);
});

router.delete("/api/objects/:id", (ctx) => {
  requireAdmin(ctx.user);
  deleteObject(found(getObject(idParam(ctx)), "Объект").id);
  return { ok: true };
});

/* deals */

router.get("/api/deals", (ctx) => {
  requireMember(ctx.user);
  return listDeals({
    objectId: queryNum(ctx, "objectId"),
    stage: (ctx.url.searchParams.get("stage") as DealStage | null) ?? undefined,
    q: ctx.url.searchParams.get("q") ?? undefined,
  });
});

router.get("/api/deals/:id", (ctx) => {
  requireMember(ctx.user);
  const deal = found(getDeal(idParam(ctx)), "Сделка");
  return { deal, tasks: listTasks({ dealId: deal.id }) };
});

const dealInput = (b: Body): Partial<DealInput> => ({
  objectId: num(b, "objectId"),
  title: str(b, "title", 200) || undefined,
  clientName: str(b, "clientName", 200),
  clientContact: str(b, "clientContact", 200),
  amount: num(b, "amount"),
  stage: oneOf<DealStage>(b, "stage", DEAL_STAGES),
  notes: str(b, "notes"),
});

router.post("/api/deals", (ctx) => {
  requireStaff(ctx.user);
  const input = dealInput(bodyOf(ctx));
  const objectId = found(
    input.objectId ? getObject(input.objectId) : undefined,
    "Объект"
  ).id;
  const title = requiredStr(bodyOf(ctx), "title");
  return getDeal(createDeal({ ...input, objectId, title }, ctx.user.id));
});

router.patch("/api/deals/:id", (ctx) => {
  requireStaff(ctx.user);
  const id = found(getDeal(idParam(ctx)), "Сделка").id;
  const input = dealInput(bodyOf(ctx));
  if (input.objectId) {
    found(getObject(input.objectId), "Объект");
  }
  updateDeal(id, input);
  return getDeal(id);
});

router.delete("/api/deals/:id", (ctx) => {
  requireAdmin(ctx.user);
  deleteDeal(found(getDeal(idParam(ctx)), "Сделка").id);
  return { ok: true };
});

/* tasks */

router.get("/api/tasks", (ctx) => {
  requireMember(ctx.user);
  const q = ctx.url.searchParams;
  const status = q.get("status");
  const mine = q.get("mine") === "1";
  const mineFilter =
    ctx.user.role === "client"
      ? { createdBy: ctx.user.id }
      : { assigneeId: ctx.user.id };
  return listTasks({
    dealId: queryNum(ctx, "dealId"),
    objectId: queryNum(ctx, "objectId"),
    status:
      status === "open" || TASK_STATUSES.includes(status as TaskStatus)
        ? (status as TaskStatus | "open")
        : undefined,
    q: q.get("q") ?? undefined,
    ...(mine ? mineFilter : {}),
  });
});

router.get("/api/tasks/:id", (ctx) => {
  requireMember(ctx.user);
  const task = found(getTask(idParam(ctx)), "Задача");
  return {
    task,
    comments: listComments(task.id),
    activity: listActivity(task.id),
  };
});

router.post("/api/tasks", async (ctx) => {
  requireMember(ctx.user);
  const b = bodyOf(ctx);
  const dealId = num(b, "dealId");
  const deal = found(dealId ? getDeal(dealId) : undefined, "Сделка");
  const input: TaskInput = {
    dealId: deal.id,
    title: requiredStr(b, "title"),
    description: str(b, "description", 5000),
    priority: oneOf<Priority>(b, "priority", PRIORITIES),
    dueDate: nullableDate(b, "dueDate"),
    assigneeId: isStaff(ctx.user.role) ? nullableUser(b, "assigneeId") : null,
  };
  const task = found(getTask(createTask(input, ctx.user.id)), "Задача");
  await onTaskCreated(task, ctx.user);
  return task;
});

router.patch("/api/tasks/:id", async (ctx) => {
  requireMember(ctx.user);
  const before = found(getTask(idParam(ctx)), "Задача");
  const b = bodyOf(ctx);
  const patch: TaskPatch = {
    title: str(b, "title", 200) || undefined,
    description: str(b, "description", 5000),
    status: oneOf<TaskStatus>(b, "status", TASK_STATUSES),
    priority: oneOf<Priority>(b, "priority", PRIORITIES),
    dueDate: nullableDate(b, "dueDate"),
    assigneeId: nullableUser(b, "assigneeId"),
  };
  if (!isStaff(ctx.user.role)) {
    checkClientPatch(before, patch, ctx.user);
  }
  const changes = describeChanges(before, patch);
  updateTask(before.id, patch);
  const after = found(getTask(before.id), "Задача");
  await onTaskUpdated(after, changes, ctx.user);
  return after;
});

router.delete("/api/tasks/:id", (ctx) => {
  requireStaff(ctx.user);
  deleteTask(found(getTask(idParam(ctx)), "Задача").id);
  return { ok: true };
});

router.post("/api/tasks/:id/comments", async (ctx) => {
  requireMember(ctx.user);
  const task = found(getTask(idParam(ctx)), "Задача");
  const body = requiredStr(bodyOf(ctx), "body", 4000);
  addComment(task.id, ctx.user.id, body);
  await onComment(task, ctx.user, body);
  return listComments(task.id);
});
