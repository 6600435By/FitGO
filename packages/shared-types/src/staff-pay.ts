/** Role-specific pay / motivation profiles (edited on Staff, used by payroll). */

export type StaffPayTrack =
  | 'ADMIN'
  | 'GROUP_TRAINER'
  | 'SPA'
  | 'TECH'
  | 'PT';

export interface PtPercentTier {
  /** Inclusive min count of conducted PT in calendar month (gifts count). */
  minSessions: number;
  /** Percent of paid conducted PT price. */
  percent: number;
}

export interface SpaQuotaServiceRate {
  /** BODY_COMPOSITION | CLASSIC_MASSAGE | or SpaService id */
  serviceKey: string;
  label: string;
  /** Fixed rate per rendered quota service, minor units. */
  rateMinor: number;
}

export interface StaffPayProfile {
  track: StaffPayTrack;
  /** ADMIN / TECH / GROUP / PT duty: hourly rate (minor). */
  hourlyRateMinor?: number;
  /** ADMIN: % of membership sales. */
  membershipSalesPercent?: number;
  /** ADMIN: % of extra services sales. */
  extraSalesPercent?: number;
  /** GROUP: fixed per conducted class when attendees >= min. */
  groupSessionRateMinor?: number;
  groupMinAttendees?: number;
  /** Optional per-attendee top-up above min. */
  groupPerAttendeeMinor?: number;
  /** SPA: % of sold/rendered paid services. */
  spaSoldPercent?: number;
  /** SPA: fixed rates for membership-package services. */
  spaQuotaRates?: SpaQuotaServiceRate[];
  /** PT: volume tiers for % of paid conducted sessions. */
  ptPercentTiers?: PtPercentTier[];
  /** PT: session catalog price (minor) when booking has no CRM price. */
  ptSessionPriceMinor?: number;
  /** ADMIN / штатный PT: fixed advance paid on the 25th (days 1–15), minor units. */
  fixedAdvanceMinor?: number;
  notes?: string;
  /**
   * Extra department schemes for multi-role staff.
   * Flat fields above always mirror `track` for backward compatibility.
   */
  byTrack?: Partial<Record<StaffPayTrack, StaffPayTrackSlice>>;
}

/** One department scheme without nested byTrack. */
export type StaffPayTrackSlice = Omit<StaffPayProfile, 'byTrack'>;

/** Role ↔ pay department for staff filters / copy. */
export type StaffDepartment =
  | 'ADMIN'
  | 'TRAINER'
  | 'SPECIALIST'
  | 'TECH';

export function payTrackForDepartment(
  dept: StaffDepartment,
): StaffPayTrack {
  if (dept === 'ADMIN') return 'ADMIN';
  if (dept === 'SPECIALIST') return 'SPA';
  if (dept === 'TECH') return 'TECH';
  return 'PT';
}

export function departmentsForPayTrack(track: StaffPayTrack): StaffDepartment[] {
  if (track === 'ADMIN') return ['ADMIN'];
  if (track === 'SPA') return ['SPECIALIST'];
  if (track === 'TECH') return ['TECH'];
  return ['TRAINER'];
}

/** Parse "2,5" / "2.5" to minor units (kopecks). Empty → 0. */
export function parseMoneyToMinor(raw: string): number {
  const n = parseDecimal(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Parse decimal allowing comma. */
export function parseDecimal(raw: string): number {
  const cleaned = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (!cleaned || cleaned === '.' || cleaned === '-') return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Display minor as decimal string without forcing integers. */
export function formatMinor(minor: number | undefined | null): string {
  const v = (minor ?? 0) / 100;
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toFixed(4)).toString());
}

export function formatPercent(value: number | undefined | null): string {
  const v = value ?? 0;
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toFixed(4)).toString());
}

/** Flatten profile for a track (byTrack wins, else default empty). */
export function sliceForTrack(
  profile: StaffPayProfile | null | undefined,
  track: StaffPayTrack,
): StaffPayTrackSlice {
  if (!profile) return defaultPayProfile(track);
  if (profile.byTrack?.[track]) {
    return { ...profile.byTrack[track]!, track };
  }
  if (profile.track === track) {
    const { byTrack: _b, ...rest } = profile;
    return rest;
  }
  return defaultPayProfile(track);
}

/** All department slices stored on a profile (including primary track). */
export function allPaySlices(
  profile: StaffPayProfile | null | undefined,
): StaffPayTrackSlice[] {
  if (!profile) return [];
  const tracks = new Set<StaffPayTrack>([profile.track]);
  for (const t of Object.keys(profile.byTrack ?? {}) as StaffPayTrack[]) {
    tracks.add(t);
  }
  return [...tracks].map((t) => sliceForTrack(profile, t));
}

/** Pack editor state: current track fields + other byTrack entries. */
export function packPayProfile(
  current: StaffPayTrackSlice,
  byTrack: Partial<Record<StaffPayTrack, StaffPayTrackSlice>>,
): StaffPayProfile {
  const next: Partial<Record<StaffPayTrack, StaffPayTrackSlice>> = {
    ...byTrack,
    [current.track]: { ...current },
  };
  delete (next[current.track] as StaffPayProfile).byTrack;
  return {
    ...current,
    byTrack: next,
  };
}

export const DEFAULT_PT_TIERS: PtPercentTier[] = [
  { minSessions: 0, percent: 50 },
  { minSessions: 101, percent: 60 },
  { minSessions: 151, percent: 70 },
];

export const DEFAULT_SPA_QUOTA_RATES: SpaQuotaServiceRate[] = [
  {
    serviceKey: 'BODY_COMPOSITION',
    label: 'Анализ состава тела',
    rateMinor: 0,
  },
  {
    serviceKey: 'CLASSIC_MASSAGE',
    label: 'Массаж классический',
    rateMinor: 0,
  },
];

export function defaultPayProfile(track: StaffPayTrack): StaffPayProfile {
  switch (track) {
    case 'ADMIN':
      return {
        track,
        hourlyRateMinor: 0,
        membershipSalesPercent: 0,
        extraSalesPercent: 0,
        fixedAdvanceMinor: 0,
      };
    case 'GROUP_TRAINER':
      return {
        track,
        groupSessionRateMinor: 0,
        groupMinAttendees: 1,
        groupPerAttendeeMinor: 0,
      };
    case 'SPA':
      return {
        track,
        spaSoldPercent: 0,
        spaQuotaRates: DEFAULT_SPA_QUOTA_RATES.map((r) => ({ ...r })),
      };
    case 'TECH':
      return {
        track,
        hourlyRateMinor: 0,
        notes: 'Премии и штрафы — отдельными корректировками в расчёте ЗП',
      };
    case 'PT':
      return {
        track,
        ptPercentTiers: DEFAULT_PT_TIERS.map((t) => ({ ...t })),
        ptSessionPriceMinor: 0,
        hourlyRateMinor: 0,
        fixedAdvanceMinor: 0,
      };
  }
}

export function payProfileSummary(profile: StaffPayProfile | null | undefined): string[] {
  if (!profile) return ['Ставки не заданы'];
  const chips: string[] = [];
  const money = (minor: number) => {
    const v = minor / 100;
    return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
  };
  for (const slice of allPaySlices(profile)) {
    const tag =
      allPaySlices(profile).length > 1 ? `${slice.track}: ` : '';
    switch (slice.track) {
      case 'ADMIN':
        if (slice.hourlyRateMinor)
          chips.push(`${tag}${money(slice.hourlyRateMinor)}/ч`);
        if (slice.membershipSalesPercent)
          chips.push(`${tag}абн. ${formatPercent(slice.membershipSalesPercent)}%`);
        if (slice.extraSalesPercent)
          chips.push(`${tag}доп. ${formatPercent(slice.extraSalesPercent)}%`);
        if (slice.fixedAdvanceMinor)
          chips.push(
            `${tag}аванс 25-е ${money(slice.fixedAdvanceMinor)}`,
          );
        break;
      case 'GROUP_TRAINER':
        if (slice.hourlyRateMinor)
          chips.push(`${tag}${money(slice.hourlyRateMinor)}/ч смены`);
        if (slice.groupSessionRateMinor)
          chips.push(`${tag}занятие ${money(slice.groupSessionRateMinor)}`);
        if (slice.groupMinAttendees)
          chips.push(`${tag}от ${slice.groupMinAttendees} чел.`);
        if (slice.groupPerAttendeeMinor)
          chips.push(`${tag}+${money(slice.groupPerAttendeeMinor)}/чел`);
        break;
      case 'SPA':
        if (slice.spaSoldPercent)
          chips.push(`${tag}услуги ${formatPercent(slice.spaSoldPercent)}%`);
        for (const r of slice.spaQuotaRates ?? []) {
          if (r.rateMinor > 0)
            chips.push(`${tag}${r.label}: ${money(r.rateMinor)}`);
        }
        break;
      case 'TECH':
        if (slice.hourlyRateMinor)
          chips.push(`${tag}${money(slice.hourlyRateMinor)}/ч`);
        else chips.push(`${tag}часы`);
        chips.push(`${tag}± премия/штраф`);
        break;
      case 'PT':
        if (slice.hourlyRateMinor)
          chips.push(`${tag}${money(slice.hourlyRateMinor)}/ч смены`);
        if (slice.fixedAdvanceMinor)
          chips.push(
            `${tag}аванс 25-е ${money(slice.fixedAdvanceMinor)}`,
          );
        if (slice.ptSessionPriceMinor)
          chips.push(`${tag}ПТ ${money(slice.ptSessionPriceMinor)}`);
        for (const t of slice.ptPercentTiers ?? []) {
          chips.push(`${tag}≥${t.minSessions}: ${formatPercent(t.percent)}%`);
        }
        break;
    }
  }
  return chips.length ? chips : ['Ставки не заданы'];
}

export function resolvePtPercent(
  sessionCountInMonth: number,
  tiers: PtPercentTier[] = DEFAULT_PT_TIERS,
): number {
  const sorted = [...tiers].sort((a, b) => a.minSessions - b.minSessions);
  let pct = sorted[0]?.percent ?? 50;
  for (const t of sorted) {
    if (sessionCountInMonth >= t.minSessions) pct = t.percent;
  }
  return pct;
}
