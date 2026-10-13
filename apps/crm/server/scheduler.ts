import {
  addMonths,
  type Deal,
  isOpenStatus,
  isStaff,
  maintenanceChecklist,
  STATUS_LABELS,
  type Task,
  type User,
} from "../shared/model.ts";
import { runBackup } from "./backup.ts";
import { logActivity } from "./chat-repo.ts";
import { config } from "./config.ts";
import {
  claimReminder,
  createTask,
  dealsDueForService,
  dueUpTo,
  getTask,
  listTasks,
  listUsers,
  setNextServiceDate,
  systemActorFor,
  visitsBetween,
} from "./repo.ts";
import { notifyTask } from "./service.ts";
import { html, notify } from "./telegram.ts";
import { dayBoundsUtc, formatLocal, localParts } from "./time.ts";

const VISIT_LEAD_MS = 60 * 60_000;
/** Digest goes out within this many hours after DIGEST_HOUR, never at night. */
const DIGEST_WINDOW_H = 3;
const LIST_LIMIT = 8;
const BACKUP_HOUR = 3;

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

/* --------------------------- planned maintenance -------------------------- */

/**
 * Creates the "ТО" task for every deal whose maintenance date has come, then
 * moves the date past today (missed periods while offline make one task).
 */
/** First maintenance date strictly after `today`. */
export const nextAfter = (from: string, months: number, today: string) => {
  let next = from;
  while (next <= today) {
    next = addMonths(next, months);
  }
  return next;
};

const createMaintenanceTask = async (
  deal: Deal,
  due: string,
  next: string,
  today: string
) => {
  const actor = systemActorFor(deal);
  if (!actor) {
    return;
  }
  const id = createTask(
    {
      dealId: deal.id,
      kind: "maintenance",
      title: `ТО: ${deal.title}`,
      description: `Плановое обслуживание раз в ${deal.serviceMonths} мес. Следующее — ${next}.`,
      dueDate: due < today ? today : due,
      checklist: maintenanceChecklist(deal.service),
    },
    actor.id
  );
  logActivity(id, actor.id, "🧰 создана автоматически по графику ТО");
  const task = getTask(id, actor.id);
  if (!task) {
    return;
  }
  const where = task.objectAddress
    ? `${task.objectName}, ${task.objectAddress}`
    : task.objectName;
  await notifyTask(task, 0, {
    text: html`🧰 <b>Плановое ТО</b>\n<b>#${task.id} ${task.title}</b>\n🏗 ${where}\nСрок: ${task.dueDate ?? today}`,
  });
};

/**
 * Creates the "ТО" task for every deal whose maintenance date has come, then
 * moves the date past today (missed periods while offline make one task).
 */
const planMaintenance = async (now: Date) => {
  const today = localParts(now, config.timeZone).date;
  for (const deal of dealsDueForService(today)) {
    const due = deal.nextServiceDate;
    if (due && claimReminder(`service:${deal.id}:${due}`)) {
      const next = nextAfter(due, deal.serviceMonths, today);
      setNextServiceDate(deal.id, next);
      await createMaintenanceTask(deal, due, next, today);
    }
  }
};

/** Nightly backup between 03:00 and 06:00 local time, once per day. */
const backupAtNight = (now: Date) => {
  const local = localParts(now, config.timeZone);
  const night = local.hour >= BACKUP_HOUR && local.hour < BACKUP_HOUR + 3;
  if (night && claimReminder(`backup:${local.date}`)) {
    runBackup();
  }
};

const tick = async () => {
  const now = new Date();
  await remindVisits(now).catch((e: unknown) => {
    process.stderr.write(`visit reminders failed: ${String(e)}\n`);
  });
  await planMaintenance(now).catch((e: unknown) => {
    process.stderr.write(`maintenance planning failed: ${String(e)}\n`);
  });
  await sendDigest(now).catch((e: unknown) => {
    process.stderr.write(`digest failed: ${String(e)}\n`);
  });
  try {
    backupAtNight(now);
  } catch (e) {
    process.stderr.write(`backup failed: ${String(e)}\n`);
  }
};

export const startScheduler = (): void => {
  tick().catch(() => null);
  setInterval(() => {
    tick().catch(() => null);
  }, config.schedulerTickMs);
};
