import {
  type CrmObject,
  type Dashboard,
  DEAL_STAGES,
  type Deal,
  type DealInput,
  type DealStage,
  type ObjectInput,
  type Role,
  TASK_STATUSES,
  type Task,
  type TaskInput,
  type TaskPatch,
  type TaskStatus,
  type User,
} from "../shared/model.ts";
import { config } from "./config.ts";
import {
  all,
  defined,
  NOW_SQL,
  nameSql,
  one,
  type Params,
  run,
  whereSql,
} from "./db.ts";

/* ---------------------------------- users --------------------------------- */

const USER_SELECT = `SELECT id, first_name AS firstName, last_name AS lastName,
  username, role, created_at AS createdAt FROM users`;

export type TelegramProfile = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
};

export const getUser = (id: number): User | undefined =>
  one<User>(`${USER_SELECT} WHERE id = :id`, { id });

export const upsertUser = (profile: TelegramProfile): User => {
  const count = one<{ n: number }>("SELECT count(*) AS n FROM users");
  // Without ADMIN_IDS the very first user to open the app becomes the owner.
  const isFirst = config.adminIds.length === 0 && (count?.n ?? 0) === 0;
  const isConfiguredAdmin = config.adminIds.includes(profile.id);
  run(
    `INSERT INTO users (id, first_name, last_name, username, role)
     VALUES (:id, :firstName, :lastName, :username, :role)
     ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name,
       last_name = excluded.last_name, username = excluded.username`,
    {
      id: profile.id,
      firstName: profile.first_name,
      lastName: profile.last_name ?? null,
      username: profile.username ?? null,
      role: isFirst || isConfiguredAdmin ? "admin" : "guest",
    }
  );
  if (isConfiguredAdmin) {
    run("UPDATE users SET role = 'admin' WHERE id = :id", { id: profile.id });
  }
  const user = getUser(profile.id);
  if (!user) {
    throw new Error("Failed to persist user");
  }
  return user;
};

export const listUsers = (): User[] =>
  all<User>(
    `${USER_SELECT} ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1
     WHEN 'client' THEN 2 ELSE 3 END, first_name`
  );

export const setUserRole = (id: number, role: Role): void => {
  run("UPDATE users SET role = :role WHERE id = :id", { id, role });
};

/** Everyone with access (not guests) — the team is tiny, so all get notified. */
export const memberIds = (): number[] =>
  all<{ id: number }>("SELECT id FROM users WHERE role != 'guest'").map(
    (r) => r.id
  );

/* --------------------------------- objects -------------------------------- */

const OBJECT_SELECT = `SELECT o.id, o.name, o.address, o.description,
  o.contact_name AS contactName, o.contact_phone AS contactPhone,
  o.access_notes AS accessNotes, o.archived, o.created_at AS createdAt,
  (SELECT count(*) FROM deals d WHERE d.object_id = o.id) AS dealsCount,
  (SELECT count(*) FROM tasks t JOIN deals d ON d.id = t.deal_id
    WHERE d.object_id = o.id AND t.status NOT IN ('done', 'canceled')) AS openTasksCount
  FROM objects o`;

type ObjectRow = Omit<CrmObject, "archived"> & { archived: number };

const toObject = (row: ObjectRow): CrmObject => ({
  ...row,
  archived: row.archived === 1,
});

export const listObjects = (): CrmObject[] =>
  all<ObjectRow>(`${OBJECT_SELECT} ORDER BY o.archived, o.name`).map(toObject);

export const getObject = (id: number): CrmObject | undefined => {
  const row = one<ObjectRow>(`${OBJECT_SELECT} WHERE o.id = :id`, { id });
  return row ? toObject(row) : undefined;
};

const objectParams = (o: ObjectInput): Params => ({
  name: o.name,
  address: o.address ?? "",
  description: o.description ?? "",
  contactName: o.contactName ?? "",
  contactPhone: o.contactPhone ?? "",
  accessNotes: o.accessNotes ?? "",
  archived: o.archived ? 1 : 0,
});

export const createObject = (input: ObjectInput): number =>
  run(
    `INSERT INTO objects (name, address, description, contact_name,
       contact_phone, access_notes, archived)
     VALUES (:name, :address, :description, :contactName, :contactPhone,
       :accessNotes, :archived)`,
    objectParams(input)
  );

export const updateObject = (id: number, patch: Partial<ObjectInput>): void => {
  const current = getObject(id);
  if (!current) {
    return;
  }
  run(
    `UPDATE objects SET name = :name, address = :address,
       description = :description, contact_name = :contactName,
       contact_phone = :contactPhone, access_notes = :accessNotes,
       archived = :archived
     WHERE id = :id`,
    { id, ...objectParams({ ...current, ...defined(patch) }) }
  );
};

export const deleteObject = (id: number): void => {
  run("DELETE FROM objects WHERE id = :id", { id });
};

/* ---------------------------------- deals --------------------------------- */

const DEAL_SELECT = `SELECT d.id, d.object_id AS objectId, o.name AS objectName,
  d.title, d.service, d.client_name AS clientName,
  d.client_contact AS clientContact, d.amount, d.monthly_fee AS monthlyFee,
  d.internet_speed AS internetSpeed, d.connection_type AS connectionType,
  d.cameras_count AS camerasCount, d.archive_days AS archiveDays,
  d.stage, d.notes, d.created_at AS createdAt, d.updated_at AS updatedAt,
  (SELECT count(*) FROM tasks t WHERE t.deal_id = d.id) AS tasksCount,
  (SELECT count(*) FROM tasks t WHERE t.deal_id = d.id
    AND t.status NOT IN ('done', 'canceled')) AS openTasksCount
  FROM deals d JOIN objects o ON o.id = d.object_id`;

export type DealFilter = {
  objectId?: number;
  stage?: DealStage;
  q?: string;
};

export const listDeals = (filter: DealFilter = {}): Deal[] => {
  const where: string[] = [];
  const params: Params = {};
  if (filter.objectId) {
    where.push("d.object_id = :objectId");
    params.objectId = filter.objectId;
  }
  if (filter.stage) {
    where.push("d.stage = :stage");
    params.stage = filter.stage;
  }
  if (filter.q) {
    where.push(
      `(ulower(d.title) LIKE :q OR ulower(d.client_name) LIKE :q
        OR ulower(o.name) LIKE :q OR ulower(o.address) LIKE :q)`
    );
    params.q = `%${filter.q.toLowerCase()}%`;
  }
  return all<Deal>(
    `${DEAL_SELECT} ${whereSql(where)}
     ORDER BY CASE d.stage WHEN 'done' THEN 1 WHEN 'lost' THEN 1 ELSE 0 END,
     d.updated_at DESC`,
    params
  );
};

export const getDeal = (id: number): Deal | undefined =>
  one<Deal>(`${DEAL_SELECT} WHERE d.id = :id`, { id });

const dealParams = (d: DealInput): Params => ({
  objectId: d.objectId,
  title: d.title,
  service: d.service ?? "internet",
  clientName: d.clientName ?? "",
  clientContact: d.clientContact ?? "",
  amount: d.amount ?? 0,
  monthlyFee: d.monthlyFee ?? 0,
  internetSpeed: d.internetSpeed ?? 0,
  connectionType: d.connectionType ?? "",
  camerasCount: d.camerasCount ?? 0,
  archiveDays: d.archiveDays ?? 0,
  stage: d.stage ?? "lead",
  notes: d.notes ?? "",
});

export const createDeal = (input: DealInput, createdBy: number): number =>
  run(
    `INSERT INTO deals (object_id, title, service, client_name, client_contact,
       amount, monthly_fee, internet_speed, connection_type, cameras_count,
       archive_days, stage, notes, created_by)
     VALUES (:objectId, :title, :service, :clientName, :clientContact,
       :amount, :monthlyFee, :internetSpeed, :connectionType, :camerasCount,
       :archiveDays, :stage, :notes, :createdBy)`,
    { ...dealParams(input), createdBy }
  );

export const updateDeal = (id: number, patch: Partial<DealInput>): void => {
  const current = getDeal(id);
  if (!current) {
    return;
  }
  run(
    `UPDATE deals SET object_id = :objectId, title = :title,
       service = :service, client_name = :clientName,
       client_contact = :clientContact, amount = :amount,
       monthly_fee = :monthlyFee, internet_speed = :internetSpeed,
       connection_type = :connectionType, cameras_count = :camerasCount,
       archive_days = :archiveDays, stage = :stage, notes = :notes,
       updated_at = ${NOW_SQL}
     WHERE id = :id`,
    { id, ...dealParams({ ...current, ...defined(patch) }) }
  );
};

export const deleteDeal = (id: number): void => {
  run("DELETE FROM deals WHERE id = :id", { id });
};

const touchDeal = (id: number): void => {
  run(`UPDATE deals SET updated_at = ${NOW_SQL} WHERE id = :id`, { id });
};

/* ---------------------------------- tasks --------------------------------- */

/** Needs `:uid` — the viewer, for the unread counter. */
const TASK_SELECT = `SELECT t.id, t.deal_id AS dealId, d.title AS dealTitle,
  d.service, d.object_id AS objectId, o.name AS objectName,
  o.address AS objectAddress, t.kind, t.title, t.description, t.status,
  t.priority, t.due_date AS dueDate, t.assignee_id AS assigneeId,
  CASE WHEN a.id IS NULL THEN NULL ELSE ${nameSql("a")} END AS assigneeName,
  t.created_by AS createdBy, coalesce(${nameSql("c")}, '') AS createdByName,
  t.created_at AS createdAt, t.updated_at AS updatedAt,
  (SELECT count(*) FROM comments m WHERE m.task_id = t.id) AS messagesCount,
  (SELECT count(*) FROM comments m WHERE m.task_id = t.id
    AND m.author_id != :uid
    AND m.id > coalesce((SELECT r.last_read_id FROM task_reads r
      WHERE r.task_id = t.id AND r.user_id = :uid), 0)) AS unreadCount
  FROM tasks t
  JOIN deals d ON d.id = t.deal_id
  JOIN objects o ON o.id = d.object_id
  LEFT JOIN users a ON a.id = t.assignee_id
  LEFT JOIN users c ON c.id = t.created_by`;

export type TaskFilter = {
  dealId?: number;
  objectId?: number;
  status?: TaskStatus | "open";
  assigneeId?: number;
  createdBy?: number;
  q?: string;
};

const taskWhere = (filter: TaskFilter): { clause: string; params: Params } => {
  const where: string[] = [];
  const params: Params = {};
  const eq: [keyof TaskFilter, string][] = [
    ["dealId", "t.deal_id"],
    ["objectId", "d.object_id"],
    ["assigneeId", "t.assignee_id"],
    ["createdBy", "t.created_by"],
  ];
  for (const [key, column] of eq) {
    const value = filter[key];
    if (value !== undefined) {
      where.push(`${column} = :${key}`);
      params[key] = value;
    }
  }
  if (filter.status === "open") {
    where.push("t.status NOT IN ('done', 'canceled')");
  } else if (filter.status) {
    where.push("t.status = :status");
    params.status = filter.status;
  }
  if (filter.q) {
    where.push(
      `(ulower(t.title) LIKE :q OR ulower(t.description) LIKE :q
        OR ulower(d.title) LIKE :q OR ulower(o.name) LIKE :q
        OR ulower(o.address) LIKE :q)`
    );
    params.q = `%${filter.q.toLowerCase()}%`;
  }
  return { clause: whereSql(where), params };
};

export const listTasks = (filter: TaskFilter, viewerId: number): Task[] => {
  const { clause, params } = taskWhere(filter);
  return all<Task>(
    `${TASK_SELECT} ${clause}
     ORDER BY CASE WHEN t.status IN ('done', 'canceled') THEN 1 ELSE 0 END,
       CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
         WHEN 'normal' THEN 2 ELSE 3 END,
       t.due_date IS NULL, t.due_date, t.id DESC
     LIMIT 500`,
    { ...params, uid: viewerId }
  );
};

export const getTask = (id: number, viewerId: number): Task | undefined =>
  one<Task>(`${TASK_SELECT} WHERE t.id = :id`, { id, uid: viewerId });

export const createTask = (input: TaskInput, createdBy: number): number => {
  const id = run(
    `INSERT INTO tasks (deal_id, kind, title, description, priority, due_date,
       assignee_id, created_by)
     VALUES (:dealId, :kind, :title, :description, :priority, :dueDate,
       :assigneeId, :createdBy)`,
    {
      dealId: input.dealId,
      kind: input.kind ?? "other",
      title: input.title,
      description: input.description ?? "",
      priority: input.priority ?? "normal",
      dueDate: input.dueDate ?? null,
      assigneeId: input.assigneeId ?? null,
      createdBy,
    }
  );
  touchDeal(input.dealId);
  return id;
};

export const updateTask = (id: number, patch: TaskPatch): void => {
  const t = getTask(id, 0);
  if (!t) {
    return;
  }
  const next = { ...t, ...defined(patch) };
  run(
    `UPDATE tasks SET kind = :kind, title = :title, description = :description,
       status = :status, priority = :priority, due_date = :dueDate,
       assignee_id = :assigneeId, updated_at = ${NOW_SQL}
     WHERE id = :id`,
    {
      id,
      kind: next.kind,
      title: next.title,
      description: next.description,
      status: next.status,
      priority: next.priority,
      dueDate: next.dueDate,
      assigneeId: next.assigneeId,
    }
  );
  touchDeal(t.dealId);
};

/** Bumps `updated_at` so open chats notice that the task card changed. */
export const touchTask = (id: number): void => {
  run(`UPDATE tasks SET updated_at = ${NOW_SQL} WHERE id = :id`, { id });
};

export const deleteTask = (id: number): void => {
  run("DELETE FROM tasks WHERE id = :id", { id });
};

/* --------------------------------- invites -------------------------------- */

export const createInvite = (
  code: string,
  role: Role,
  createdBy: number
): void => {
  run(
    `INSERT INTO invites (code, role, created_by)
     VALUES (:code, :role, :createdBy)`,
    { code, role, createdBy }
  );
};

export const redeemInvite = (
  code: string,
  userId: number
): { role: Role } | null => {
  const invite = one<{ role: Role }>(
    "SELECT role FROM invites WHERE code = :code AND used_by IS NULL",
    { code }
  );
  if (!invite) {
    return null;
  }
  run("UPDATE invites SET used_by = :userId WHERE code = :code", {
    code,
    userId,
  });
  return invite;
};

/* -------------------------------- dashboard ------------------------------- */

const countBy = <K extends string>(
  keys: readonly K[],
  rows: { key: string; n: number }[]
): Record<K, number> => {
  const result = Object.fromEntries(keys.map((k) => [k, 0])) as Record<
    K,
    number
  >;
  for (const row of rows) {
    if ((keys as readonly string[]).includes(row.key)) {
      result[row.key as K] = row.n;
    }
  }
  return result;
};

const scalar = (sql: string, params: Params = {}): number =>
  one<{ n: number }>(sql, params)?.n ?? 0;

const OPEN = "status NOT IN ('done', 'canceled')";
const ACTIVE_DEAL = "stage NOT IN ('done', 'lost')";

export const dashboard = (user: User): Dashboard => {
  // For the customer "mine" means tasks they raised; for staff — assigned ones.
  const mineColumn = user.role === "client" ? "created_by" : "assignee_id";
  return {
    tasksByStatus: countBy(
      TASK_STATUSES,
      all("SELECT status AS key, count(*) AS n FROM tasks GROUP BY status")
    ),
    dealsByStage: countBy(
      DEAL_STAGES,
      all("SELECT stage AS key, count(*) AS n FROM deals GROUP BY stage")
    ),
    overdue: scalar(
      `SELECT count(*) AS n FROM tasks WHERE ${OPEN} AND due_date < date('now')`
    ),
    myOpen: scalar(
      `SELECT count(*) AS n FROM tasks WHERE ${OPEN} AND ${mineColumn} = :uid`,
      { uid: user.id }
    ),
    urgentOpen: scalar(
      `SELECT count(*) AS n FROM tasks WHERE ${OPEN}
       AND (priority = 'urgent' OR kind = 'repair')`
    ),
    pipelineAmount: scalar(
      `SELECT coalesce(sum(amount), 0) AS n FROM deals WHERE ${ACTIVE_DEAL}`
    ),
    monthlyRecurring: scalar(
      "SELECT coalesce(sum(monthly_fee), 0) AS n FROM deals WHERE stage = 'done'"
    ),
  };
};
