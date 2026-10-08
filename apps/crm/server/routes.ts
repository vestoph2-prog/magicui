import {
  CONNECTION_TYPES,
  type ConnectionType,
  DEAL_STAGES,
  type DealInput,
  type DealStage,
  isStaff,
  type ObjectInput,
  PRIORITIES,
  type Priority,
  ROLES,
  type Role,
  SERVICES,
  type Service,
  TASK_KINDS,
  TASK_STATUSES,
  type TaskInput,
  type TaskKind,
  type TaskPatch,
  type TaskStatus,
} from "../shared/model.ts";
import {
  deleteMessage,
  getMessage,
  inbox,
  listActivity,
  listMessages,
  markRead,
  totalUnread,
} from "./chat-repo.ts";
import { type Ctx, createRouter, HttpError } from "./http.ts";
import {
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
  listDeals,
  listObjects,
  listTasks,
  listUsers,
  setUserRole,
  updateDeal,
  updateObject,
  updateTask,
} from "./repo.ts";
import {
  applyStartParam,
  applyTemplate,
  describeChanges,
  makeInvite,
  onTaskCreated,
  onTaskUpdated,
  postMessage,
  touchPresence,
} from "./service.ts";
import { isUploadName, readUpload } from "./uploads.ts";
import {
  type Body,
  bodyOf,
  checkClientPatch,
  found,
  idParam,
  nullableDate,
  nullableUser,
  num,
  oneOf,
  queryNum,
  requireAdmin,
  requiredStr,
  requireMember,
  requireStaff,
  str,
} from "./validate.ts";

export const router = createRouter();

const taskOr404 = (ctx: Ctx) =>
  found(getTask(idParam(ctx), ctx.user.id), "Задача");

/* ---------------------------------- users --------------------------------- */

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

/* --------------------------------- objects -------------------------------- */

const objectInput = (b: Body): Partial<ObjectInput> => ({
  name: str(b, "name", 200) || undefined,
  address: str(b, "address", 300),
  description: str(b, "description"),
  contactName: str(b, "contactName", 200),
  contactPhone: str(b, "contactPhone", 100),
  accessNotes: str(b, "accessNotes", 1000),
  archived: typeof b.archived === "boolean" ? b.archived : undefined,
});

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
  return getObject(
    createObject({ ...objectInput(b), name: requiredStr(b, "name") })
  );
});

router.patch("/api/objects/:id", (ctx) => {
  requireStaff(ctx.user);
  const id = found(getObject(idParam(ctx)), "Объект").id;
  updateObject(id, objectInput(bodyOf(ctx)));
  return getObject(id);
});

router.delete("/api/objects/:id", (ctx) => {
  requireAdmin(ctx.user);
  deleteObject(found(getObject(idParam(ctx)), "Объект").id);
  return { ok: true };
});

/* ---------------------------------- deals --------------------------------- */

const dealInput = (b: Body): Partial<DealInput> => ({
  objectId: num(b, "objectId"),
  title: str(b, "title", 200) || undefined,
  service: oneOf<Service>(b, "service", SERVICES),
  clientName: str(b, "clientName", 200),
  clientContact: str(b, "clientContact", 200),
  amount: num(b, "amount"),
  monthlyFee: num(b, "monthlyFee"),
  internetSpeed: num(b, "internetSpeed"),
  connectionType: oneOf<ConnectionType>(b, "connectionType", CONNECTION_TYPES),
  camerasCount: num(b, "camerasCount"),
  archiveDays: num(b, "archiveDays"),
  stage: oneOf<DealStage>(b, "stage", DEAL_STAGES),
  notes: str(b, "notes"),
});

router.get("/api/deals", (ctx) => {
  requireMember(ctx.user);
  return listDeals({
    objectId: queryNum(ctx, "objectId"),
    q: ctx.url.searchParams.get("q") ?? undefined,
  });
});

router.get("/api/deals/:id", (ctx) => {
  requireMember(ctx.user);
  const deal = found(getDeal(idParam(ctx)), "Сделка");
  return { deal, tasks: listTasks({ dealId: deal.id }, ctx.user.id) };
});

router.post("/api/deals", (ctx) => {
  requireStaff(ctx.user);
  const b = bodyOf(ctx);
  const input = dealInput(b);
  const objectId = found(
    input.objectId ? getObject(input.objectId) : undefined,
    "Объект"
  ).id;
  const title = requiredStr(b, "title");
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

router.post("/api/deals/:id/template", (ctx) => {
  requireStaff(ctx.user);
  const deal = found(getDeal(idParam(ctx)), "Сделка");
  return { created: applyTemplate(deal, ctx.user) };
});

router.delete("/api/deals/:id", (ctx) => {
  requireAdmin(ctx.user);
  deleteDeal(found(getDeal(idParam(ctx)), "Сделка").id);
  return { ok: true };
});

/* ---------------------------------- tasks --------------------------------- */

router.get("/api/tasks", (ctx) => {
  requireMember(ctx.user);
  const q = ctx.url.searchParams;
  const status = q.get("status");
  const mineFilter =
    ctx.user.role === "client"
      ? { createdBy: ctx.user.id }
      : { assigneeId: ctx.user.id };
  return listTasks(
    {
      dealId: queryNum(ctx, "dealId"),
      objectId: queryNum(ctx, "objectId"),
      status:
        status === "open" || TASK_STATUSES.includes(status as TaskStatus)
          ? (status as TaskStatus | "open")
          : undefined,
      q: q.get("q") ?? undefined,
      ...(q.get("mine") === "1" ? mineFilter : {}),
    },
    ctx.user.id
  );
});

router.get("/api/tasks/:id", (ctx) => {
  requireMember(ctx.user);
  return taskOr404(ctx);
});

router.post("/api/tasks", async (ctx) => {
  requireMember(ctx.user);
  const b = bodyOf(ctx);
  const dealId = num(b, "dealId");
  const deal = found(dealId ? getDeal(dealId) : undefined, "Сделка");
  const kind = oneOf<TaskKind>(b, "kind", TASK_KINDS);
  const input: TaskInput = {
    dealId: deal.id,
    kind,
    title: requiredStr(b, "title"),
    description: str(b, "description", 5000),
    // A breakdown is urgent by default.
    priority:
      oneOf<Priority>(b, "priority", PRIORITIES) ??
      (kind === "repair" ? "urgent" : undefined),
    dueDate: nullableDate(b, "dueDate"),
    assigneeId: isStaff(ctx.user.role) ? nullableUser(b, "assigneeId") : null,
  };
  const id = createTask(input, ctx.user.id);
  const task = found(getTask(id, ctx.user.id), "Задача");
  await onTaskCreated(task, ctx.user);
  return task;
});

router.patch("/api/tasks/:id", async (ctx) => {
  requireMember(ctx.user);
  const before = taskOr404(ctx);
  const b = bodyOf(ctx);
  const patch: TaskPatch = {
    kind: oneOf<TaskKind>(b, "kind", TASK_KINDS),
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
  const after = found(getTask(before.id, ctx.user.id), "Задача");
  await onTaskUpdated(after, changes, ctx.user);
  return after;
});

router.delete("/api/tasks/:id", (ctx) => {
  requireStaff(ctx.user);
  deleteTask(taskOr404(ctx).id);
  return { ok: true };
});

/* ---------------------------------- chat ---------------------------------- */

/**
 * Initial load (no `after`) or incremental poll. Also marks the chat as read
 * and records presence so the viewer isn't pinged in Telegram meanwhile.
 */
router.get("/api/tasks/:id/chat", (ctx) => {
  requireMember(ctx.user);
  const task = taskOr404(ctx);
  const after = queryNum(ctx, "after") ?? 0;
  const afterActivity = queryNum(ctx, "afterActivity") ?? 0;
  const messages = listMessages(task.id, after);
  const last = messages.at(-1);
  if (last) {
    markRead(ctx.user.id, task.id, last.id);
  }
  touchPresence(task.id, ctx.user.id);
  return {
    messages,
    activity: listActivity(task.id, afterActivity),
    taskUpdatedAt: task.updatedAt,
  };
});

router.post("/api/tasks/:id/messages", async (ctx) => {
  requireMember(ctx.user);
  const task = taskOr404(ctx);
  const b = bodyOf(ctx);
  const body = str(b, "body", 4000) ?? "";
  const attachment = isUploadName(b.attachment) ? b.attachment : null;
  if (!(body || attachment)) {
    throw new HttpError(400, "Пустое сообщение");
  }
  return await postMessage(task, ctx.user, {
    body,
    attachment,
    replyTo: num(b, "replyTo") ?? null,
  });
});

router.delete("/api/messages/:id", (ctx) => {
  requireMember(ctx.user);
  const message = found(getMessage(idParam(ctx)), "Сообщение");
  if (message.authorId !== ctx.user.id && ctx.user.role !== "admin") {
    throw new HttpError(403, "Можно удалять только свои сообщения");
  }
  deleteMessage(message.id);
  return { ok: true };
});

router.get("/api/inbox", (ctx) => {
  requireMember(ctx.user);
  return inbox(ctx.user.id);
});

router.get("/api/unread", (ctx) => {
  requireMember(ctx.user);
  return { total: totalUnread(ctx.user.id) };
});

router.post("/api/uploads", async (ctx) => {
  requireMember(ctx.user);
  return { file: await readUpload(ctx.req) };
});
