/** SPA waitlist: exact slot vs flexible availability window. */

export type SpaWaitlistPreference = 'EXACT' | 'WINDOW';

/** Monday = bit 0 (1) … Sunday = bit 6 (64). All days = 127. */
export const SPA_WAITLIST_WEEKDAY_ALL = 127;
export const SPA_WAITLIST_WEEKDAY_WEEKDAYS = 1 + 2 + 4 + 8 + 16; // Mon–Fri
export const SPA_WAITLIST_WEEKDAY_WEEKEND = 32 + 64; // Sat–Sun
export const SPA_WAITLIST_MAX_WINDOW_DAYS = 62;

export const SPA_WAITLIST_WEEKDAY_LABELS_RU = [
  'пн',
  'вт',
  'ср',
  'чт',
  'пт',
  'сб',
  'вс',
] as const;

export type SpaWaitlistMatchInput = {
  preference?: SpaWaitlistPreference | null;
  specialistId: string;
  desiredStartAt: string;
  desiredEndAt: string;
  windowStart?: string | null;
  windowEnd?: string | null;
  timeFromMin?: number | null;
  timeToMin?: number | null;
  weekdays?: number | null;
};

export type SpaWaitlistSlotMatch = {
  fits: boolean;
  /** Slot start is inside the window, but service end would pass timeToMin. */
  exceedsWindow: boolean;
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/** Local calendar YYYY-MM-DD for a Date. */
export function spaLocalDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Minutes from local midnight. */
export function spaLocalMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** JS getDay() (0=Sun) → bitmask bit for our Mon=1 … Sun=64 scheme. */
export function spaJsDayToWeekdayBit(jsDay: number): number {
  const bitIndex = jsDay === 0 ? 6 : jsDay - 1;
  return 1 << bitIndex;
}

export function spaWeekdayMaskHas(mask: number, jsDay: number): boolean {
  return (mask & spaJsDayToWeekdayBit(jsDay)) !== 0;
}

export function formatSpaWaitlistMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function formatDateShortRu(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  });
}

function formatDateWithWeekdayRu(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    weekday: 'short',
  });
}

function weekdaysPhraseRu(mask: number): string {
  const m = mask & SPA_WAITLIST_WEEKDAY_ALL;
  if (m === SPA_WAITLIST_WEEKDAY_ALL) return 'любой день';
  if (m === SPA_WAITLIST_WEEKDAY_WEEKDAYS) return 'будни';
  if (m === SPA_WAITLIST_WEEKDAY_WEEKEND) return 'выходные';
  const parts: string[] = [];
  for (let i = 0; i < 7; i++) {
    if (m & (1 << i)) parts.push(SPA_WAITLIST_WEEKDAY_LABELS_RU[i]!);
  }
  return parts.join(', ') || '—';
}

function timeBandPhraseRu(
  timeFromMin: number | null | undefined,
  timeToMin: number | null | undefined,
): string {
  if (
    timeFromMin == null ||
    timeToMin == null ||
    (timeFromMin === 0 && timeToMin >= 24 * 60)
  ) {
    return 'весь день';
  }
  return `${formatSpaWaitlistMinutes(timeFromMin)}–${formatSpaWaitlistMinutes(timeToMin)}`;
}

/**
 * Human-readable preference for list / pick dialog.
 * Exact: "21 окт, 10:00". Window: "21–27 окт · будни · 09:00–12:00".
 */
export function formatSpaWaitlistPreference(
  entry: SpaWaitlistMatchInput & { preference?: SpaWaitlistPreference | null },
): string {
  const pref = entry.preference ?? 'EXACT';
  if (pref === 'WINDOW' && entry.windowStart && entry.windowEnd) {
    const same = entry.windowStart === entry.windowEnd;
    const dates = same
      ? formatDateShortRu(entry.windowStart)
      : `${formatDateShortRu(entry.windowStart)}–${formatDateShortRu(entry.windowEnd)}`;
    const days = weekdaysPhraseRu(entry.weekdays ?? SPA_WAITLIST_WEEKDAY_ALL);
    const hours = timeBandPhraseRu(entry.timeFromMin, entry.timeToMin);
    return `${dates} · ${days} · ${hours}`;
  }
  const start = new Date(entry.desiredStartAt);
  if (Number.isNaN(start.getTime())) return '—';
  const ymd = spaLocalDateKey(start);
  const time = start.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${formatDateWithWeekdayRu(ymd)}, ${time}`;
}

/** Whether a board day (local YYYY-MM-DD) intersects the entry's availability. */
export function spaWaitlistFitsBoardDay(
  entry: SpaWaitlistMatchInput,
  boardDayYmd: string,
): boolean {
  const pref = entry.preference ?? 'EXACT';
  if (pref === 'WINDOW' && entry.windowStart && entry.windowEnd) {
    if (boardDayYmd < entry.windowStart || boardDayYmd > entry.windowEnd) {
      return false;
    }
    const d = new Date(`${boardDayYmd}T12:00:00`);
    if (Number.isNaN(d.getTime())) return false;
    return spaWeekdayMaskHas(
      entry.weekdays ?? SPA_WAITLIST_WEEKDAY_ALL,
      d.getDay(),
    );
  }
  return spaLocalDateKey(new Date(entry.desiredStartAt)) === boardDayYmd;
}

/**
 * Does this slot start fit the waitlist preference for the given specialist?
 * For WINDOW, only the start time must lie in the hour band; service may run past.
 */
export function spaWaitlistFitsSlot(
  entry: SpaWaitlistMatchInput,
  specialistId: string,
  slotStartAt: string,
  slotEndAt?: string,
  serviceDurationMin?: number,
): SpaWaitlistSlotMatch {
  if (entry.specialistId !== specialistId) {
    return { fits: false, exceedsWindow: false };
  }

  const slotStart = new Date(slotStartAt);
  if (Number.isNaN(slotStart.getTime())) {
    return { fits: false, exceedsWindow: false };
  }

  const pref = entry.preference ?? 'EXACT';

  if (pref === 'WINDOW' && entry.windowStart && entry.windowEnd) {
    const ymd = spaLocalDateKey(slotStart);
    if (ymd < entry.windowStart || ymd > entry.windowEnd) {
      return { fits: false, exceedsWindow: false };
    }
    if (
      !spaWeekdayMaskHas(
        entry.weekdays ?? SPA_WAITLIST_WEEKDAY_ALL,
        slotStart.getDay(),
      )
    ) {
      return { fits: false, exceedsWindow: false };
    }
    const startMin = spaLocalMinutes(slotStart);
    const from = entry.timeFromMin;
    const to = entry.timeToMin;
    if (from != null && to != null) {
      if (startMin < from || startMin >= to) {
        return { fits: false, exceedsWindow: false };
      }
    }
    let exceedsWindow = false;
    if (to != null && serviceDurationMin != null && serviceDurationMin > 0) {
      exceedsWindow = startMin + serviceDurationMin > to;
    } else if (to != null && slotEndAt) {
      const end = new Date(slotEndAt);
      if (!Number.isNaN(end.getTime()) && spaLocalDateKey(end) === ymd) {
        exceedsWindow = spaLocalMinutes(end) > to;
      }
    }
    return { fits: true, exceedsWindow };
  }

  // EXACT: interval overlap (legacy)
  const slotEnd = slotEndAt
    ? new Date(slotEndAt)
    : new Date(slotStart.getTime() + 60 * 60 * 1000);
  const s = new Date(entry.desiredStartAt).getTime();
  const e = new Date(entry.desiredEndAt).getTime();
  const fits =
    !Number.isNaN(s) &&
    !Number.isNaN(e) &&
    !Number.isNaN(slotEnd.getTime()) &&
    s < slotEnd.getTime() &&
    e > slotStart.getTime();
  return { fits, exceedsWindow: false };
}

/** Sort key: entries that fit board day first, then oldest waiting (createdAt asc). */
export function compareSpaWaitlistForBoard(
  a: SpaWaitlistMatchInput & { createdAt: string; id: string },
  b: SpaWaitlistMatchInput & { createdAt: string; id: string },
  boardDayYmd: string,
): number {
  const aFit = spaWaitlistFitsBoardDay(a, boardDayYmd) ? 0 : 1;
  const bFit = spaWaitlistFitsBoardDay(b, boardDayYmd) ? 0 : 1;
  if (aFit !== bFit) return aFit - bFit;
  const ca = new Date(a.createdAt).getTime();
  const cb = new Date(b.createdAt).getTime();
  if (ca !== cb) return ca - cb;
  return a.id.localeCompare(b.id);
}

export function daysBetweenYmdInclusive(startYmd: string, endYmd: string): number {
  const a = new Date(`${startYmd}T12:00:00`);
  const b = new Date(`${endYmd}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return -1;
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000) + 1;
}
