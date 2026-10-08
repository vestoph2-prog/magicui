import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  type Activity,
  type Comment,
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

type Params = Record<string, SQLInputValue>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT,
  username TEXT,
  role TEXT NOT NULL DEFAULT 'guest',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS objects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  client_name TEXT NOT NULL DEFAULT '',
  client_contact TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'lead',
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  priority TEXT NOT NULL DEFAULT 'normal',
  due_date TEXT,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  used_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_deals_object ON deals(object_id);
CREATE INDEX IF NOT EXISTS idx_tasks_deal ON tasks(deal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);
CREATE INDEX IF NOT EXISTS idx_activity_task ON activity(task_id);
`;

const openDatabase = (): DatabaseSync => {
  if (config.dbPath !== ":memory:") {
    mkdirSync(dirname(config.dbPath), { recursive: true });
  }
  const database = new DatabaseSync(config.dbPath);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  database.exec(SCHEMA);
  // SQLite's lower() only folds ASCII; this one handles Cyrillic for search.
  database.function("ulower", { deterministic: true }, (value) =>
    typeof value === "string" ? value.toLowerCase() : value
  );
  return database;
};

export const db = openDatabase();

const all = <T>(sql: string, params: Params = {}): T[] =>
  db.prepare(sql).all(params) as unknown as T[];

const one = <T>(sql: string, params: Params = {}): T | undefined =>
  db.prepare(sql).get(params) as unknown as T | undefined;

const run = (sql: string, params: Params = {}): number =>
  Number(db.prepare(sql).run(params).lastInsertRowid);

const NAME_SQL = (alias: string) =>
  `trim(${alias}.first_name || ' ' || coalesce(${alias}.last_name, ''))`;

/* ---------------------------------- users --------------------------------- */

const USER_SELECT = `SELECT id, first_name AS firstName, last_name AS lastName,
  username, role, created_at AS createdAt FROM users`;

export type TelegramProfile = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
};

export const upsertUser = (profile: TelegramProfile): User => {
  const hasUsers = one<{ n: number }>("SELECT count(*) AS n FROM users");
  // Without ADMIN_IDS the very first user to open the app becomes the owner.
  const isFirst = config.adminIds.length === 0 && (hasUsers?.n ?? 0) === 0;
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

export const getUser = (id: number): User | undefined =>
  one<User>(`${USER_SELECT} WHERE id = :id`, { id });

export const listUsers = (): User[] =>
  all<User>(
    `${USER_SELECT} ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1
     WHEN 'client' THEN 2 ELSE 3 END, first_name`
  );

export const setUserRole = (id: number, role: Role): void => {
  run("UPDATE users SET role = :role WHERE id = :id", { id, role });
};

export const staffIds = (): number[] =>
  all<{ id: number }>(
    "SELECT id FROM users WHERE role IN ('admin', 'manager')"
  ).map((r) => r.id);

/** Everyone with access (not guests) — the team is tiny, so all get notified. */
export const memberIds = (): number[] =>
  all<{ id: number }>("SELECT id FROM users WHERE role != 'guest'").map(
    (r) => r.id
  );

/* --------------------------------- objects -------------------------------- */

const OBJECT_SELECT = `SELECT o.id, o.name, o.address, o.description,
  o.archived, o.created_at AS createdAt,
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

export const createObject = (input: ObjectInput): number =>
  run(
    `INSERT INTO objects (name, address, description)
     VALUES (:name, :address, :description)`,
    {
      name: input.name,
      address: input.address ?? "",
      description: input.description ?? "",
    }
  );

export const updateObject = (id: number, input: Partial<ObjectInput>): void => {
  const current = getObject(id);
  if (!current) {
    return;
  }
  run(
    `UPDATE objects SET name = :name, address = :address,
     description = :description, archived = :archived WHERE id = :id`,
    {
      id,
      name: input.name ?? current.name,
      address: input.address ?? current.address,
      description: input.description ?? current.description,
      archived: (input.archived ?? current.archived) ? 1 : 0,
    }
  );
};

export const deleteObject = (id: number): void => {
  run("DELETE FROM objects WHERE id = :id", { id });
};

/* ---------------------------------- deals --------------------------------- */

const DEAL_SELECT = `SELECT d.id, d.object_id AS objectId, o.name AS objectName,
  d.title, d.client_name AS clientName,
  d.client_contact AS clientContact, d.amount, d.stage, d.notes,
  d.created_at AS createdAt, d.updated_at AS updatedAt,
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
      "(ulower(d.title) LIKE :q OR ulower(d.client_name) LIKE :q OR ulower(o.name) LIKE :q)"
    );
    params.q = `%${filter.q.toLowerCase()}%`;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return all<Deal>(
    `${DEAL_SELECT} ${clause}
     ORDER BY CASE d.stage WHEN 'done' THEN 1 WHEN 'lost' THEN 1 ELSE 0 END,
     d.updated_at DESC`,
    params
  );
};

export const getDeal = (id: number): Deal | undefined =>
  one<Deal>(`${DEAL_SELECT} WHERE d.id = :id`, { id });

export const createDeal = (input: DealInput, createdBy: number): number =>
  run(
    `INSERT INTO deals (object_id, title, client_name, client_contact, amount,
       stage, notes, created_by)
     VALUES (:objectId, :title, :clientName, :clientContact, :amount, :stage,
       :notes, :createdBy)`,
    {
      objectId: input.objectId,
      title: input.title,
      clientName: input.clientName ?? "",
      clientContact: input.clientContact ?? "",
      amount: input.amount ?? 0,
      stage: input.stage ?? "lead",
      notes: input.notes ?? "",
      createdBy,
    }
  );

export const updateDeal = (id: number, input: Partial<DealInput>): void => {
  const d = getDeal(id);
  if (!d) {
    return;
  }
  run(
    `UPDATE deals SET object_id = :objectId, title = :title,
       client_name = :clientName,
       client_contact = :clientContact, amount = :amount, stage = :stage,
       notes = :notes, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = :id`,
    {
      id,
      objectId: input.objectId ?? d.objectId,
      title: input.title ?? d.title,
      clientName: input.clientName ?? d.clientName,
      clientContact: input.clientContact ?? d.clientContact,
      amount: input.amount ?? d.amount,
      stage: input.stage ?? d.stage,
      notes: input.notes ?? d.notes,
    }
  );
};

export const deleteDeal = (id: number): void => {
  run("DELETE FROM deals WHERE id = :id", { id });
};

export const touchDeal = (id: number): void => {
  run(
    "UPDATE deals SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = :id",
    { id }
  );
};

/* ---------------------------------- tasks --------------------------------- */

const TASK_SELECT = `SELECT t.id, t.deal_id AS dealId, d.title AS dealTitle,
  d.object_id AS objectId, o.name AS objectName, t.title, t.description,
  t.status, t.priority, t.due_date AS dueDate, t.assignee_id AS assigneeId,
  CASE WHEN a.id IS NULL THEN NULL ELSE ${NAME_SQL("a")} END AS assigneeName,
  t.created_by AS createdBy, coalesce(${NAME_SQL("c")}, '') AS createdByName,
  t.created_at AS createdAt, t.updated_at AS updatedAt,
  (SELECT count(*) FROM comments m WHERE m.task_id = t.id) AS commentsCount
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
        OR ulower(d.title) LIKE :q OR ulower(o.name) LIKE :q)`
    );
    params.q = `%${filter.q.toLowerCase()}%`;
  }
  return {
    clause: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
};

export const listTasks = (filter: TaskFilter = {}): Task[] => {
  const { clause, params } = taskWhere(filter);
  return all<Task>(
    `${TASK_SELECT} ${clause}
     ORDER BY CASE WHEN t.status IN ('done', 'canceled') THEN 1 ELSE 0 END,
       CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
         WHEN 'normal' THEN 2 ELSE 3 END,
       t.due_date IS NULL, t.due_date, t.id DESC
     LIMIT 500`,
    params
  );
};

export const getTask = (id: number): Task | undefined =>
  one<Task>(`${TASK_SELECT} WHERE t.id = :id`, { id });

export const createTask = (input: TaskInput, createdBy: number): number => {
  const id = run(
    `INSERT INTO tasks (deal_id, title, description, priority, due_date,
       assignee_id, created_by)
     VALUES (:dealId, :title, :description, :priority, :dueDate, :assigneeId,
       :createdBy)`,
    {
      dealId: input.dealId,
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
  const t = getTask(id);
  if (!t) {
    return;
  }
  run(
    `UPDATE tasks SET title = :title, description = :description,
       status = :status, priority = :priority, due_date = :dueDate,
       assignee_id = :assigneeId,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = :id`,
    {
      id,
      title: patch.title ?? t.title,
      description: patch.description ?? t.description,
      status: patch.status ?? t.status,
      priority: patch.priority ?? t.priority,
      dueDate: patch.dueDate === undefined ? t.dueDate : patch.dueDate,
      assigneeId:
        patch.assigneeId === undefined ? t.assigneeId : patch.assigneeId,
    }
  );
  touchDeal(t.dealId);
};

export const deleteTask = (id: number): void => {
  run("DELETE FROM tasks WHERE id = :id", { id });
};

/* ------------------------------ comments, log ----------------------------- */

export const listComments = (taskId: number): Comment[] =>
  all<Comment>(
    `SELECT m.id, m.task_id AS taskId, m.author_id AS authorId,
       ${NAME_SQL("u")} AS authorName, m.body, m.created_at AS createdAt
     FROM comments m JOIN users u ON u.id = m.author_id
     WHERE m.task_id = :taskId ORDER BY m.id`,
    { taskId }
  );

export const addComment = (
  taskId: number,
  authorId: number,
  body: string
): number =>
  run(
    "INSERT INTO comments (task_id, author_id, body) VALUES (:taskId, :authorId, :body)",
    { taskId, authorId, body }
  );

export const logActivity = (
  taskId: number,
  actorId: number,
  text: string
): void => {
  run(
    "INSERT INTO activity (task_id, actor_id, text) VALUES (:taskId, :actorId, :text)",
    { taskId, actorId, text }
  );
};

export const listActivity = (taskId: number): Activity[] =>
  all<Activity>(
    `SELECT a.id, a.task_id AS taskId, ${NAME_SQL("u")} AS actorName, a.text,
       a.created_at AS createdAt
     FROM activity a JOIN users u ON u.id = a.actor_id
     WHERE a.task_id = :taskId ORDER BY a.id`,
    { taskId }
  );

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

type InviteRow = { code: string; role: Role };

export const redeemInvite = (
  code: string,
  userId: number
): InviteRow | null => {
  const invite = one<InviteRow>(
    `SELECT code, role FROM invites
     WHERE code = :code AND used_by IS NULL`,
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

export const dashboard = (user: User): Dashboard => {
  const tasks = all<{ key: string; n: number }>(
    "SELECT status AS key, count(*) AS n FROM tasks GROUP BY status"
  );
  const deals = all<{ key: string; n: number }>(
    "SELECT stage AS key, count(*) AS n FROM deals GROUP BY stage"
  );
  const overdue = one<{ n: number }>(
    `SELECT count(*) AS n FROM tasks
     WHERE status NOT IN ('done', 'canceled') AND due_date < date('now')`
  );
  // For the customer "mine" means tasks they raised; for staff — assigned ones.
  const mineColumn = user.role === "client" ? "created_by" : "assignee_id";
  const myOpen = one<{ n: number }>(
    `SELECT count(*) AS n FROM tasks
     WHERE status NOT IN ('done', 'canceled') AND ${mineColumn} = :uid`,
    { uid: user.id }
  );
  const pipeline = one<{ n: number }>(
    `SELECT coalesce(sum(amount), 0) AS n FROM deals
     WHERE stage NOT IN ('done', 'lost')`
  );
  return {
    tasksByStatus: countBy(TASK_STATUSES, tasks),
    dealsByStage: countBy(DEAL_STAGES, deals),
    overdue: overdue?.n ?? 0,
    myOpen: myOpen?.n ?? 0,
    pipelineAmount: pipeline?.n ?? 0,
  };
};
