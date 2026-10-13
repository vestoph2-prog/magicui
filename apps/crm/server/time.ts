/** Local calendar date and hour in an IANA time zone, without libraries. */
export const localParts = (
  at: Date,
  timeZone: string
): { date: string; hour: number } => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
};

/** Minutes the zone is ahead of UTC at a given instant (Moscow: +180). */
const offsetMinutes = (at: Date, timeZone: string): number => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((x) => [x.type, Number(x.value)])
  ) as Record<string, number>;
  const asUtc = Date.UTC(
    p.year ?? 0,
    (p.month ?? 1) - 1,
    p.day ?? 1,
    p.hour ?? 0,
    p.minute ?? 0,
    p.second ?? 0
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
};

/** [start, end) of a local calendar day as ISO UTC strings. */
export const dayBoundsUtc = (
  date: string,
  timeZone: string
): { start: string; end: string } => {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  const offset = offsetMinutes(noon, timeZone) * 60_000;
  const start = Date.UTC(y, m - 1, d) - offset;
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + 86_400_000).toISOString(),
  };
};

const timeFormat = (timeZone: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** "10.10, 13:00" in the business time zone — for bot messages. */
export const formatLocal = (iso: string, timeZone: string): string =>
  timeFormat(timeZone).format(new Date(iso));
