import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { config } from "./config.ts";

export type Params = Record<string, SQLInputValue>;

export const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT,
  username TEXT,
  role TEXT NOT NULL DEFAULT 'guest',
  created_at TEXT NOT NULL DEFAULT (${NOW_SQL})
);

CREATE TABLE IF NOT EXISTS objects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (${NOW_SQL})
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
  created_at TEXT NOT NULL DEFAULT (${NOW_SQL}),
  updated_at TEXT NOT NULL DEFAULT (${NOW_SQL})
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
  created_at TEXT NOT NULL DEFAULT (${NOW_SQL}),
  updated_at TEXT NOT NULL DEFAULT (${NOW_SQL})
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (${NOW_SQL})
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (${NOW_SQL})
);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  used_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (${NOW_SQL})
);

CREATE INDEX IF NOT EXISTS idx_deals_object ON deals(object_id);
CREATE INDEX IF NOT EXISTS idx_tasks_deal ON tasks(deal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);
CREATE INDEX IF NOT EXISTS idx_activity_task ON activity(task_id);
`;

/** v2: internet / CCTV specifics and the task chat. */
const SCHEMA_V2 = `
ALTER TABLE objects ADD COLUMN contact_name TEXT NOT NULL DEFAULT '';
ALTER TABLE objects ADD COLUMN contact_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE objects ADD COLUMN access_notes TEXT NOT NULL DEFAULT '';

ALTER TABLE deals ADD COLUMN service TEXT NOT NULL DEFAULT 'internet';
ALTER TABLE deals ADD COLUMN monthly_fee REAL NOT NULL DEFAULT 0;
ALTER TABLE deals ADD COLUMN internet_speed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deals ADD COLUMN connection_type TEXT NOT NULL DEFAULT '';
ALTER TABLE deals ADD COLUMN cameras_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deals ADD COLUMN archive_days INTEGER NOT NULL DEFAULT 0;
UPDATE deals SET stage = 'survey' WHERE stage = 'negotiation';
UPDATE deals SET stage = 'install' WHERE stage = 'in_work';

ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'other';

ALTER TABLE comments ADD COLUMN reply_to INTEGER REFERENCES comments(id) ON DELETE SET NULL;
ALTER TABLE comments ADD COLUMN attachment TEXT;
ALTER TABLE comments ADD COLUMN source TEXT NOT NULL DEFAULT 'app';

CREATE TABLE task_reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, task_id)
);

-- Bot messages about a task: a Telegram reply to one goes into the task chat.
CREATE TABLE tg_links (
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (${NOW_SQL}),
  PRIMARY KEY (chat_id, message_id)
);
`;

/** v3: several photos per message (JSON array of upload names). */
const SCHEMA_V3 = `
ALTER TABLE comments ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
UPDATE comments SET attachments = json_array(attachment) WHERE attachment IS NOT NULL;
ALTER TABLE comments DROP COLUMN attachment;
`;

const MIGRATIONS = [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3];

const migrate = (database: DatabaseSync) => {
  const { user_version: current } = database
    .prepare("PRAGMA user_version")
    .get() as { user_version: number };
  for (const [index, sql] of MIGRATIONS.entries()) {
    if (index < current) {
      continue;
    }
    database.exec("BEGIN");
    try {
      database.exec(sql);
      database.exec(`PRAGMA user_version = ${index + 1}`);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
};

const openDatabase = (): DatabaseSync => {
  if (config.dbPath !== ":memory:") {
    mkdirSync(dirname(config.dbPath), { recursive: true });
  }
  const database = new DatabaseSync(config.dbPath);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrate(database);
  // SQLite's lower() only folds ASCII; this one handles Cyrillic for search.
  database.function("ulower", { deterministic: true }, (value) =>
    typeof value === "string" ? value.toLowerCase() : value
  );
  return database;
};

export const db = openDatabase();

export const all = <T>(sql: string, params: Params = {}): T[] =>
  db.prepare(sql).all(params) as unknown as T[];

export const one = <T>(sql: string, params: Params = {}): T | undefined =>
  db.prepare(sql).get(params) as unknown as T | undefined;

export const run = (sql: string, params: Params = {}): number =>
  Number(db.prepare(sql).run(params).lastInsertRowid);

export const nameSql = (alias: string) =>
  `trim(${alias}.first_name || ' ' || coalesce(${alias}.last_name, ''))`;

export const whereSql = (conditions: string[]): string =>
  conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

/** Drops `undefined` so `{ ...current, ...defined(patch) }` keeps old values. */
export const defined = <T extends object>(patch: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined)
  ) as Partial<T>;
