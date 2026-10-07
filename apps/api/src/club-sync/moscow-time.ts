/** Europe/Moscow helpers — never use bare Date#getHours() for night windows. */

const MOSCOW = 'Europe/Moscow';

/** 1C / FitGOAnalytics timestamps are club wall clock (Minsk = Moscow offset). */
const CLUB_OFFSET_MS = 3 * 3600_000;

/**
 * Parse `yyyy-MM-ddTHH:mm:ss` from 1C as club local time.
 * Node treats timezone-less ISO as UTC — that shifts UI times +3h vs 1C.
 */
export function parseClubWallClock(
  value: string | null | undefined,
): Date | null {
  if (!value?.trim()) return null;
  const t = value.trim();
  if (/[zZ]$/.test(t) || /[+-]\d{2}:\d{2}$/.test(t)) {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = t.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/,
  );
  if (!m) {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const h = Number(m[4]);
  const min = Number(m[5]);
  const sec = Number(m[6] ?? '0');
  const frac = m[7] ?? '0';
  const ms = Number(frac.padEnd(3, '0').slice(0, 3));
  return new Date(
    Date.UTC(y, mo - 1, day, h, min, sec, ms) - CLUB_OFFSET_MS,
  );
}

export function moscowParts(now = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: MOSCOW,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** YYYY-MM-DD in Europe/Moscow. */
export function moscowDayKey(now = new Date()): string {
  const p = moscowParts(now);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function isMoscowNightWindow(now = new Date()): boolean {
  const { hour } = moscowParts(now);
  return hour >= 3 && hour < 4;
}

export function formatMoscowDataAsOf(d: Date | null | undefined): string | null {
  if (!d) return null;
  const fmt = new Intl.DateTimeFormat('ru-RU', {
    timeZone: MOSCOW,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  // ru-RU → "06.10.2026, 15:40" — normalize to "06.10.2026 15:40"
  return fmt.format(d).replace(',', '');
}

export function addMoscowDays(dayKey: string, delta: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + delta));
  return utc.toISOString().slice(0, 10);
}

export function nextNightlyAtIso(now = new Date()): string {
  const p = moscowParts(now);
  // Next 03:00 Moscow — approximate via UTC offset +3.
  const base = new Date(
    Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0) - 3 * 3600_000,
  );
  let target = new Date(base.getTime() + 3 * 3600_000); // 03:00 Moscow that calendar day
  if (p.hour >= 4 || (p.hour === 3 && p.minute > 0 && !isMoscowNightWindow(now))) {
    // After window → tomorrow 03:00
    target = new Date(target.getTime() + 24 * 3600_000);
  } else if (p.hour < 3) {
    // before tonight's window — target is already today 03:00
  } else if (isMoscowNightWindow(now)) {
    // currently in window — next is tomorrow
    target = new Date(target.getTime() + 24 * 3600_000);
  }
  return target.toISOString();
}
