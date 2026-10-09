import {
  isOpenStatus,
  isStaff,
  STATUS_LABELS,
  type Task,
  type User,
} from "../shared/model.ts";
import { config } from "./config.ts";
import {
  claimReminder,
  dueUpTo,
  listTasks,
  listUsers,
  visitsBetween,
} from "./repo.ts";
import { notifyTask } from "./service.ts";
import { html, notify } from "./telegram.ts";
import { dayBoundsUtc, formatLocal, localParts } from "./time.ts";

const TICK_MS = 60_000;
const VISIT_LEAD_MS = 60 * 60_000;
/** Digest goes out within this many hours after DIGEST_HOUR, never at night. */
const DIGEST_WINDOW_H = 3;
const LIST_LIMIT = 8;

const timeOnly = (iso: string) =>
  formatLocal(iso, config.timeZone).split(", ").at(-1) ?? "";

const taskRef = (t: Task) => html`#${t.id} ${t.title} — ${t.objectName}`;

/* ------------------------------ visit reminder ---------------------------- */

const remindVisits = async (now: Date) => {
  const until = new Date(now.getTime() + VISIT_LEAD_MS);
  for (const task of visitsBetween(now.toISOString(), until.toISOString())) {
    if (!(task.visitAt && claimReminder(`visit:${task.id}:${task.visitAt}`))) {
      continue;
    }
    const minutes = Math.max(
      1,
      Math.round((Date.parse(task.visitAt) - now.getTime()) / 60_000)
    );
    const lines = [
      html`🚗 <b>Выезд в ${timeOnly(task.visitAt)}</b> (через ${minutes} мин)`,
      html`<b>#${task.id} ${task.title}</b>`,
      html`🏗 ${task.objectName}${task.objectAddress ? `, ${task.objectAddress}` : ""}`,
      task.assigneeName ? html`👷 ${task.assigneeName}` : "",
    ];
    await notifyTask(task, 0, { text: lines.filter(Boolean).join("\n") });
  }
};

/* ------------------------------ morning digest ---------------------------- */

export type DigestData = {
  today: string;
  visits: Task[];
  due: Task[];
  clientOpen: Task[];
};

const section = (title: string, tasks: Task[], line: (t: Task) => string) => {
  if (!tasks.length) {
    return "";
  }
  const shown = tasks.slice(0, LIST_LIMIT).map(line);
  const more =
    tasks.length > LIST_LIMIT ? `\n…и ещё ${tasks.length - LIST_LIMIT}` : "";
  return `\n\n<b>${title}</b>\n${shown.join("\n")}${more}`;
};

/** Text of the digest for one person, or null when there is nothing to say. */
export const buildDigest = (user: User, data: DigestData): string | null => {
  const visits = section(
    "🚗 Выезды сегодня",
    data.visits,
    (t) => `${timeOnly(t.visitAt ?? "")} · ${taskRef(t)}`
  );
  if (!isStaff(user.role)) {
    const mine = data.clientOpen.filter((t) => t.createdBy === user.id);
    const review = mine.filter((t) => t.status === "review");
    const requests = section(
      "Ваши заявки в работе",
      mine,
      (t) => `${STATUS_LABELS[t.status]} · ${taskRef(t)}`
    );
    const accept = review.length
      ? `\n\n👀 Ждут вашей приёмки: ${review.length}`
      : "";
    return visits || requests
      ? `☀️ Доброе утро!${visits}${requests}${accept}`
      : null;
  }
  const overdue = data.due.filter((t) => (t.dueDate ?? "") < data.today);
  const today = data.due.filter((t) => t.dueDate === data.today);
  const mark = (t: Task) => (t.assigneeId === user.id ? "👤 " : "");
  const body =
    visits +
    section("⚠️ Просрочено", overdue, (t) => `${mark(t)}${taskRef(t)}`) +
    section("📅 Срок сегодня", today, (t) => `${mark(t)}${taskRef(t)}`);
  return body ? `☀️ План на сегодня${body}` : null;
};

const sendDigest = async (now: Date) => {
  const hour = Number.parseInt(config.digestHour, 10);
  if (Number.isNaN(hour)) {
    return;
  }
  const local = localParts(now, config.timeZone);
  const inWindow = local.hour >= hour && local.hour < hour + DIGEST_WINDOW_H;
  if (!(inWindow && claimReminder(`digest:${local.date}`))) {
    return;
  }
  const { start, end } = dayBoundsUtc(local.date, config.timeZone);
  const data: DigestData = {
    today: local.date,
    visits: visitsBetween(start, end),
    due: dueUpTo(local.date),
    clientOpen: listTasks({ status: "open" }, 0).filter((t) =>
      isOpenStatus(t.status)
    ),
  };
  for (const user of listUsers()) {
    const text = user.role === "guest" ? null : buildDigest(user, data);
    if (text) {
      await notify([user.id], { text, appPath: "#/tasks" });
    }
  }
};

const tick = async () => {
  const now = new Date();
  await remindVisits(now).catch((e: unknown) => {
    process.stderr.write(`visit reminders failed: ${String(e)}\n`);
  });
  await sendDigest(now).catch((e: unknown) => {
    process.stderr.write(`digest failed: ${String(e)}\n`);
  });
};

export const startScheduler = (): void => {
  tick().catch(() => null);
  setInterval(() => {
    tick().catch(() => null);
  }, TICK_MS);
};
