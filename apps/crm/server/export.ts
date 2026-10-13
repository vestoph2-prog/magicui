import {
  CONNECTION_LABELS,
  KIND_LABELS,
  PRIORITY_LABELS,
  SERVICE_LABELS,
  STAGE_LABELS,
  STATUS_LABELS,
} from "../shared/model.ts";
import { config } from "./config.ts";
import { toCsv } from "./csv.ts";
import { listDeals, listTasks } from "./repo.ts";
import { dayBoundsUtc, formatLocal } from "./time.ts";

export type ExportKind = "tasks" | "deals";

/** "🔍 Обследование" → "Обследование" for spreadsheet cells. */
const EMOJI_PREFIX_RE = /^\S+\s/;

/** Inclusive local-date period → UTC bounds. */
const period = (from: string, to: string) => ({
  start: dayBoundsUtc(from, config.timeZone).start,
  end: dayBoundsUtc(to, config.timeZone).end,
});

const inPeriod = (
  p: { start: string; end: string },
  ...isoTimes: string[]
): boolean => isoTimes.some((t) => t >= p.start && t < p.end);

const local = (iso: string | null) =>
  iso ? formatLocal(iso, config.timeZone) : "";

const tasksCsv = (from: string, to: string) => {
  const p = period(from, to);
  const rows = listTasks({}, 0)
    .filter((t) => inPeriod(p, t.createdAt, t.updatedAt))
    .sort((a, b) => a.id - b.id)
    .map((t) => [
      t.id,
      t.objectName,
      t.objectAddress,
      t.dealTitle,
      SERVICE_LABELS[t.service],
      t.title,
      KIND_LABELS[t.kind].replace(EMOJI_PREFIX_RE, ""),
      STATUS_LABELS[t.status],
      PRIORITY_LABELS[t.priority],
      t.dueDate ?? "",
      local(t.visitAt),
      t.assigneeName ?? "",
      t.createdByName,
      local(t.createdAt),
      local(t.updatedAt),
      t.checklistTotal ? `${t.checklistDone}/${t.checklistTotal}` : "",
      t.messagesCount,
    ]);
  return toCsv(
    [
      "№",
      "Объект",
      "Адрес",
      "Сделка",
      "Услуга",
      "Задача",
      "Тип",
      "Статус",
      "Приоритет",
      "Срок",
      "Выезд",
      "Исполнитель",
      "Автор",
      "Создана",
      "Обновлена",
      "Чек-лист",
      "Сообщений",
    ],
    rows
  );
};

const dealsCsv = (from: string, to: string) => {
  const p = period(from, to);
  const rows = listDeals()
    .filter((d) => inPeriod(p, d.createdAt, d.updatedAt))
    .sort((a, b) => a.id - b.id)
    .map((d) => [
      d.id,
      d.objectName,
      d.title,
      SERVICE_LABELS[d.service],
      STAGE_LABELS[d.stage],
      d.clientName,
      d.clientContact,
      d.amount,
      d.monthlyFee,
      d.internetSpeed || "",
      d.connectionType ? CONNECTION_LABELS[d.connectionType] : "",
      d.camerasCount || "",
      d.archiveDays || "",
      d.serviceMonths ? `${d.serviceMonths} мес` : "",
      d.nextServiceDate ?? "",
      `${d.tasksCount - d.openTasksCount}/${d.tasksCount}`,
      local(d.createdAt),
      local(d.updatedAt),
    ]);
  return toCsv(
    [
      "№",
      "Объект",
      "Сделка",
      "Услуга",
      "Этап",
      "Заказчик",
      "Контакт",
      "Монтаж, ₽",
      "Абонплата, ₽/мес",
      "Скорость, Мбит/с",
      "Подключение",
      "Камер",
      "Архив, дней",
      "Период ТО",
      "Следующее ТО",
      "Задач закрыто",
      "Создана",
      "Обновлена",
    ],
    rows
  );
};

export const buildExport = (kind: ExportKind, from: string, to: string) => ({
  filename: `${kind === "tasks" ? "zadachi" : "sdelki"}_${from}_${to}.csv`,
  csv: kind === "tasks" ? tasksCsv(from, to) : dealsCsv(from, to),
});
