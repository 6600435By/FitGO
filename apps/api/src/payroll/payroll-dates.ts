/**
 * Calendar helpers for Prisma `@db.Date` fields.
 * Local `T00:00:00` shifts the stored day in UTC+ (Minsk) — always use UTC noon.
 */

/** YYYY-MM-DD → Date at UTC noon (stable for `@db.Date` write/compare). */
export function dateOnly(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) throw new Error(`Invalid date: ${iso}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
}

/** Prisma `@db.Date` → YYYY-MM-DD (UTC). */
export function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addCalendarDays(iso: string, delta: number): string {
  const dt = dateOnly(iso);
  dt.setUTCDate(dt.getUTCDate() + delta);
  return utcDateKey(dt);
}

/** Local civil today as YYYY-MM-DD (club UI, not UTC). */
export function localTodayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function localMonthStartIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Hint when a mid-period rate version starts inside [from, to].
 * Uses calendar dates only — never `toISOString` after local midnight math.
 */
export function rateChangeHintText(
  versionIsos: string[],
  from: string,
  to: string,
): string | undefined {
  const inRange = versionIsos.filter((iso) => iso > from && iso <= to);
  if (!inRange.length) return undefined;
  const iso = inRange[0]!;
  return `до ${addCalendarDays(iso, -1)} — прежняя ставка, с ${iso} — новая`;
}
