const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function relative(t: number | null, now = Date.now()): string {
  if (!t) return "never";
  const diff = now - t;
  if (diff < MIN) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} d ago`;
  return shortDate(t);
}

export function shortDate(t: number): string {
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function timeOfDay(t: number): string {
  return new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function longDate(t: number): string {
  return new Date(t).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export function fullDateTime(t: number): string {
  return new Date(t).toLocaleString(undefined, { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Card timestamp: time for today, otherwise the date. */
export function cardTime(t: number, now = Date.now()): string {
  return t >= startOfDay(now) ? timeOfDay(t) : shortDate(t);
}

export const ACCESS_LABEL = { full: "Full text", excerpt: "Excerpt", metadata: "Metadata only" } as const;
