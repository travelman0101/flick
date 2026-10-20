/** The day starts at 04:00 so late-night work still counts as "today". */
export const DAY_STARTS_AT_HOUR = 4;

const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Local "logical" date: 03:59 on the 21st is still the 20th. */
export function logicalDay(now: Date = new Date()) {
  return fmt(new Date(now.getTime() - DAY_STARTS_AT_HOUR * 3_600_000));
}

/** The logical day before `day`. */
export function previousDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return fmt(new Date(y, m - 1, d - 1));
}
