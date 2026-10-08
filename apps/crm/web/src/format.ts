const money = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

const shortDate = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
});

const dateTime = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatMoney = (value: number): string => money.format(value);

/** "2026-10-08" in the user's local time zone. */
export const today = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const formatDue = (date: string): string =>
  shortDate.format(new Date(`${date}T00:00:00`));

export const formatDateTime = (iso: string): string =>
  dateTime.format(new Date(iso));

export const isOverdue = (due: string | null): boolean =>
  Boolean(due && due < today());
