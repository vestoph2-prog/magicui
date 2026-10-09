import type { Activity, InboxItem, Message, Photo } from "../shared/model.ts";
import { all, nameSql, one, run } from "./db.ts";

const MESSAGE_SELECT = `SELECT m.id, m.task_id AS taskId, m.author_id AS authorId,
  ${nameSql("u")} AS authorName, m.body, m.attachments, m.reply_to AS replyTo,
  CASE WHEN p.id IS NULL THEN NULL ELSE ${nameSql("pu")} END AS replyAuthor,
  CASE WHEN p.id IS NULL THEN NULL
    WHEN p.body = '' AND p.attachments != '[]' THEN '📷 Фото'
    ELSE substr(p.body, 1, 140) END AS replyBody,
  m.source, m.created_at AS createdAt
  FROM comments m
  JOIN users u ON u.id = m.author_id
  LEFT JOIN comments p ON p.id = m.reply_to
  LEFT JOIN users pu ON pu.id = p.author_id`;

type MessageRow = Omit<Message, "attachments"> & { attachments: string };

const toMessage = (row: MessageRow): Message => ({
  ...row,
  attachments: JSON.parse(row.attachments) as string[],
});

export const listMessages = (taskId: number, afterId = 0): Message[] =>
  all<MessageRow>(
    `${MESSAGE_SELECT} WHERE m.task_id = :taskId AND m.id > :afterId
     ORDER BY m.id LIMIT 1000`,
    { taskId, afterId }
  ).map(toMessage);

export const getMessage = (id: number): Message | undefined => {
  const row = one<MessageRow>(`${MESSAGE_SELECT} WHERE m.id = :id`, { id });
  return row ? toMessage(row) : undefined;
};

/** Adds a photo to an existing message (Telegram albums arrive one by one). */
export const appendAttachment = (messageId: number, file: string): void => {
  run(
    `UPDATE comments SET attachments = json_insert(attachments, '$[#]', :file)
     WHERE id = :messageId`,
    { messageId, file }
  );
};

/** Every photo from the chats of an object's tasks, newest first. */
export const objectPhotos = (objectId: number): Photo[] =>
  all<Photo>(
    `SELECT j.value AS file, m.id AS messageId, t.id AS taskId,
       t.title AS taskTitle, ${nameSql("u")} AS authorName,
       m.created_at AS createdAt
     FROM comments m, json_each(m.attachments) j
     JOIN tasks t ON t.id = m.task_id
     JOIN deals d ON d.id = t.deal_id
     JOIN users u ON u.id = m.author_id
     WHERE d.object_id = :objectId
     ORDER BY m.id DESC, j.key LIMIT 300`,
    { objectId }
  );

export type NewMessage = {
  taskId: number;
  authorId: number;
  body: string;
  attachments?: string[];
  replyTo?: number | null;
  source?: "app" | "telegram";
};

export const addMessage = (m: NewMessage): number => {
  const id = run(
    `INSERT INTO comments (task_id, author_id, body, attachments, reply_to, source)
     VALUES (:taskId, :authorId, :body, :attachments, :replyTo, :source)`,
    {
      taskId: m.taskId,
      authorId: m.authorId,
      body: m.body,
      attachments: JSON.stringify(m.attachments ?? []),
      replyTo: m.replyTo ?? null,
      source: m.source ?? "app",
    }
  );
  // Your own message is read by definition.
  markRead(m.authorId, m.taskId, id);
  return id;
};

export const deleteMessage = (id: number): void => {
  run("DELETE FROM comments WHERE id = :id", { id });
};

export const markRead = (userId: number, taskId: number, lastId: number) => {
  run(
    `INSERT INTO task_reads (user_id, task_id, last_read_id)
     VALUES (:userId, :taskId, :lastId)
     ON CONFLICT(user_id, task_id) DO UPDATE
       SET last_read_id = max(last_read_id, excluded.last_read_id)`,
    { userId, taskId, lastId }
  );
};

export const totalUnread = (userId: number): number =>
  one<{ n: number }>(
    `SELECT count(*) AS n FROM comments m
     WHERE m.author_id != :uid AND m.id > coalesce((SELECT r.last_read_id
       FROM task_reads r WHERE r.task_id = m.task_id AND r.user_id = :uid), 0)`,
    { uid: userId }
  )?.n ?? 0;

type InboxRow = Omit<InboxItem, "lastHasAttachment"> & {
  lastHasAttachment: number;
};

/** Tasks with any messages, newest conversation first — the "Чаты" tab. */
export const inbox = (userId: number): InboxItem[] =>
  all<InboxRow>(
    `SELECT t.id AS taskId, t.title, t.status, t.kind, o.name AS objectName,
       d.title AS dealTitle, ${nameSql("u")} AS lastAuthor, m.body AS lastBody,
       m.attachments != '[]' AS lastHasAttachment, m.created_at AS lastAt,
       (SELECT count(*) FROM comments x WHERE x.task_id = t.id
         AND x.author_id != :uid AND x.id > coalesce((SELECT r.last_read_id
           FROM task_reads r WHERE r.task_id = t.id AND r.user_id = :uid), 0)
       ) AS unreadCount
     FROM comments m
     JOIN (SELECT task_id, max(id) AS id FROM comments GROUP BY task_id) last
       ON last.id = m.id
     JOIN tasks t ON t.id = m.task_id
     JOIN deals d ON d.id = t.deal_id
     JOIN objects o ON o.id = d.object_id
     JOIN users u ON u.id = m.author_id
     ORDER BY m.id DESC LIMIT 200`,
    { uid: userId }
  ).map((r) => ({ ...r, lastHasAttachment: r.lastHasAttachment === 1 }));

/* -------------------------------- activity -------------------------------- */

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

export const listActivity = (taskId: number, afterId = 0): Activity[] =>
  all<Activity>(
    `SELECT a.id, a.task_id AS taskId, ${nameSql("u")} AS actorName, a.text,
       a.created_at AS createdAt
     FROM activity a JOIN users u ON u.id = a.actor_id
     WHERE a.task_id = :taskId AND a.id > :afterId ORDER BY a.id`,
    { taskId, afterId }
  );

/* ------------------------------ telegram links ----------------------------- */

export const linkTelegramMessage = (
  chatId: number,
  messageId: number,
  taskId: number
): void => {
  run(
    `INSERT OR REPLACE INTO tg_links (chat_id, message_id, task_id)
     VALUES (:chatId, :messageId, :taskId)`,
    { chatId, messageId, taskId }
  );
};

export const taskForTelegramMessage = (
  chatId: number,
  messageId: number
): number | undefined =>
  one<{ taskId: number }>(
    `SELECT task_id AS taskId FROM tg_links
     WHERE chat_id = :chatId AND message_id = :messageId`,
    { chatId, messageId }
  )?.taskId;
