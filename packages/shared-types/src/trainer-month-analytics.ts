/**
 * Month analytics for trainer home + staff/club analytics extras.
 * Counts align with booking-control list filters (conducted mode).
 */

import type { BookingControlListItem, BookingControlPayment } from './booking-control';
import {
  isReformerHallSession,
  resolvePtPercent,
  type PtPercentTier,
} from './staff-pay';

/** Title match for individual reformer session / SKU. */
export function isReformerPersonalTitle(
  productName: string | null | undefined,
): boolean {
  return /индивидуальн.*реформер|реформер.*индивидуальн/i.test(
    productName ?? '',
  );
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Previous calendar month, same day-of-month window (clamped to month length).
 * Example: 2026-10-01…2026-10-25 → 2026-09-01…2026-09-25.
 */
export function sameDayPreviousMonthWindow(
  from: string,
  to: string,
): { previousFrom: string; previousTo: string } {
  const [fy, fm] = from.split('-').map(Number);
  const td = Number(to.split('-')[2] ?? '1');
  const prev = new Date(fy, fm - 2, 1);
  const py = prev.getFullYear();
  const pm = prev.getMonth() + 1;
  const lastDay = new Date(py, pm, 0).getDate();
  const day = Math.min(Math.max(1, td), lastDay);
  return {
    previousFrom: `${py}-${pad2(pm)}-01`,
    previousTo: `${py}-${pad2(pm)}-${pad2(day)}`,
  };
}

/**
 * Matches booking-control panel `conducted=1` client filter.
 * Includes one-off PT from sales (source/payTag SALE) — same units as ЗП/лестница.
 */
export function isConductedControlRow(_item?: {
  source?: string | null;
  payTag?: string | null;
}): boolean {
  return true;
}

export function controlClientKey(item: {
  clientId?: string | null;
  clientName?: string | null;
  sessionKey?: string;
}): string {
  const id = item.clientId?.trim();
  if (id) return `id:${id}`;
  const name = item.clientName?.trim().toLowerCase();
  if (name) return `name:${name}`;
  return `sess:${item.sessionKey ?? 'unknown'}`;
}

export type TrainerMonthCountDelta = {
  count: number;
  previous: number;
};

export type TrainerMonthLadderProgress = {
  volumeCount: number;
  percent: number;
  nextMinSessions: number | null;
  remaining: number | null;
  isTop: boolean;
};

export type TrainerMonthGiftConversion = {
  giftedClients: number;
  convertedClients: number;
  pct: number | null;
  previousPct: number | null;
};

export type TrainerMonthAnalytics = {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  /** Completed PT (includes gifts); deep-link kind=PT&conducted=1. */
  pt: TrainerMonthCountDelta & {
    gift: number;
    previousGift: number;
    reformerPersonal: number;
  };
  /** Completed GROUP; deep-link kind=GROUP&conducted=1. */
  group: TrainerMonthCountDelta & {
    avgAttendees: number | null;
    previousAvgAttendees: number | null;
    avgFillPct: number | null;
    previousAvgFillPct: number | null;
  };
  /** Gift PT only; deep-link payment=GIFT. Shown when count > 0. */
  gift: TrainerMonthCountDelta;
  /** Reformer split; null when trainer has none and no reformer flag. */
  reformer: {
    group: number;
    previousGroup: number;
    personal: number;
    previousPersonal: number;
  } | null;
  uniqueClients: {
    total: number;
    previous: number;
    pt: number;
    group: number;
  };
  /** Hours from StaffShift; null = hide (not staff or no shifts). */
  shiftHours: number | null;
  previousShiftHours: number | null;
  giftConversion: TrainerMonthGiftConversion | null;
  ladder: TrainerMonthLadderProgress | null;
  /** class_sessions lastSuccessAt ISO, or null. */
  syncedAt: string | null;
};

export type ConductedSliceSummary = {
  pt: number;
  gift: number;
  group: number;
  reformerGroup: number;
  reformerPersonal: number;
  uniquePt: Set<string>;
  /** Avg attendees / fill for GROUP completed rows (header counts). */
  groupAttendedSum: number;
  groupFillSum: number;
  groupFillN: number;
};

export function emptyConductedSlice(): ConductedSliceSummary {
  return {
    pt: 0,
    gift: 0,
    group: 0,
    reformerGroup: 0,
    reformerPersonal: 0,
    uniquePt: new Set(),
    groupAttendedSum: 0,
    groupFillSum: 0,
    groupFillN: 0,
  };
}

/** Summarize completed conducted rows (already filtered COMPLETED + conducted). */
export function summarizeConductedItems(
  items: Array<
    Pick<
      BookingControlListItem,
      | 'kind'
      | 'payment'
      | 'title'
      | 'roomTitle'
      | 'clientId'
      | 'clientName'
      | 'sessionKey'
      | 'arrivedCount'
      | 'attendeeCount'
      | 'bookedCount'
    > & { capacity?: number | null }
  >,
): ConductedSliceSummary {
  const out = emptyConductedSlice();
  for (const i of items) {
    if (i.kind === 'PT') {
      out.pt += 1;
      if (i.payment === 'GIFT') out.gift += 1;
      if (isReformerPersonalTitle(i.title)) out.reformerPersonal += 1;
      out.uniquePt.add(controlClientKey(i));
      continue;
    }
    if (i.kind === 'GROUP') {
      out.group += 1;
      if (isReformerHallSession(i.roomTitle, i.title)) {
        out.reformerGroup += 1;
      }
      const arrived = i.arrivedCount ?? i.attendeeCount ?? 0;
      out.groupAttendedSum += arrived;
      const cap = i.capacity ?? 0;
      if (cap > 0) {
        out.groupFillSum += (arrived / cap) * 100;
        out.groupFillN += 1;
      }
    }
  }
  return out;
}

export function resolveLadderProgress(
  volumeCount: number,
  tiers: PtPercentTier[],
): TrainerMonthLadderProgress {
  const sorted = [...tiers].sort((a, b) => a.minSessions - b.minSessions);
  const percent = resolvePtPercent(volumeCount, sorted);
  const next = sorted.find((t) => volumeCount < t.minSessions);
  if (!next) {
    return {
      volumeCount,
      percent,
      nextMinSessions: null,
      remaining: null,
      isTop: true,
    };
  }
  return {
    volumeCount,
    percent,
    nextMinSessions: next.minSessions,
    remaining: Math.max(0, next.minSessions - volumeCount),
    isTop: false,
  };
}

export type GiftConversionEvent = {
  clientKey: string;
  at: Date;
  /** GIFT cohort; PAID/QUOTA convert; PARTNER does not. */
  payment: BookingControlPayment | 'SALE';
};

/**
 * Gift → paid conversion for a period.
 * Denominator: distinct clients with ≥1 GIFT in period.
 * Numerator: those with PAID/QUOTA/SALE at or after first gift (same period).
 */
export function computeGiftToPaidConversion(
  events: GiftConversionEvent[],
): { giftedClients: number; convertedClients: number; pct: number | null } {
  const firstGift = new Map<string, Date>();
  for (const e of events) {
    if (e.payment !== 'GIFT') continue;
    const prev = firstGift.get(e.clientKey);
    if (!prev || e.at < prev) firstGift.set(e.clientKey, e.at);
  }
  const giftedClients = firstGift.size;
  if (giftedClients === 0) {
    return { giftedClients: 0, convertedClients: 0, pct: null };
  }
  let convertedClients = 0;
  for (const [key, giftAt] of firstGift) {
    const converted = events.some(
      (e) =>
        e.clientKey === key &&
        e.at >= giftAt &&
        (e.payment === 'PAID' ||
          e.payment === 'QUOTA' ||
          e.payment === 'SALE'),
    );
    if (converted) convertedClients += 1;
  }
  return {
    giftedClients,
    convertedClients,
    pct: Math.round((convertedClients / giftedClients) * 1000) / 10,
  };
}

/** Apply hall / reformer deep-link filters to control rows. */
export function filterControlByHall(
  items: BookingControlListItem[],
  hall?: 'REFORMER' | null,
  reformer?: 'personal' | null,
): BookingControlListItem[] {
  let out = items;
  if (hall === 'REFORMER') {
    out = out.filter((i) => isReformerHallSession(i.roomTitle, i.title));
  }
  if (reformer === 'personal') {
    out = out.filter(
      (i) => i.kind === 'PT' && isReformerPersonalTitle(i.title),
    );
  }
  return out;
}
