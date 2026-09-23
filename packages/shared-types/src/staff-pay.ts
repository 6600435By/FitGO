/** Role-specific pay / motivation profiles (edited on Staff, used by payroll). */

export type StaffPayTrack =
  | 'ADMIN'
  | 'GROUP_TRAINER'
  | 'SPA'
  | 'TECH'
  | 'PT';

/** Club rooms used for group-class payroll tiers. */
export type GroupRoomKey =
  | 'GROUP_SMALL'
  | 'GROUP_LARGE'
  | 'GYM'
  | 'REFORMER';

export type StaffEmploymentKind = 'STAFF' | 'EXTERNAL';

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

/** Attendee range × room → fixed pay per conducted class (minor). */
export interface GroupRateTier {
  minAttendees: number;
  /** Inclusive; omit = no upper bound. */
  maxAttendees?: number;
  roomKey: GroupRoomKey;
  rateMinor: number;
}

export interface StaffPayProfile {
  track: StaffPayTrack;
  /** ADMIN / TECH / GROUP / PT duty: hourly rate (minor). */
  hourlyRateMinor?: number;
  /** ADMIN: % of membership sales (абонементы + КП). */
  membershipSalesPercent?: number;
  /** ADMIN: % of extra services sales. */
  extraSalesPercent?: number;
  /** ADMIN: % of shop / retail sales. */
  shopSalesPercent?: number;
  /** ADMIN / manager: % of manually entered corporate (р/с) sales. */
  corporateSalesPercent?: number;
  /** GROUP: legacy flat rate when attendees >= min (fallback if no tiers). */
  groupSessionRateMinor?: number;
  groupMinAttendees?: number;
  /** Optional per-attendee top-up above min. */
  groupPerAttendeeMinor?: number;
  /** GROUP: attendee × room matrix (preferred). */
  groupRateTiers?: GroupRateTier[];
  /** SPA: % of sold/rendered paid services. */
  spaSoldPercent?: number;
  /** SPA: fixed rates for membership-package services. */
  spaQuotaRates?: SpaQuotaServiceRate[];
  /** SPA: fixed rate per AllSports / partner client visit (minor). */
  spaPartnerRateMinor?: number;
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
  | 'TECH'
  | 'EXTERNAL';

/** Exact Forma / 1C room titles → payroll room key. */
export const GROUP_ROOM_TITLE_MAP: Record<string, GroupRoomKey> = {
  'Групповой зал малый': 'GROUP_SMALL',
  'Групповой зал большой': 'GROUP_LARGE',
  'Тренажёрный зал': 'GYM',
  'Тренажерный зал': 'GYM',
  'Зал реформеров': 'REFORMER',
};

export function resolveGroupRoomKey(
  roomTitle: string | null | undefined,
): GroupRoomKey | undefined {
  if (!roomTitle?.trim()) return undefined;
  const exact = GROUP_ROOM_TITLE_MAP[roomTitle.trim()];
  if (exact) return exact;
  const lower = roomTitle.trim().toLowerCase();
  if (lower.includes('малы')) return 'GROUP_SMALL';
  if (lower.includes('больш')) return 'GROUP_LARGE';
  if (lower.includes('реформ')) return 'REFORMER';
  if (lower.includes('тренаж')) return 'GYM';
  return undefined;
}

/** Club default GP rates (BYN → minor). */
export const DEFAULT_GROUP_RATE_TIERS: GroupRateTier[] = [
  { roomKey: 'GROUP_SMALL', minAttendees: 3, maxAttendees: 5, rateMinor: 2500 },
  { roomKey: 'GROUP_SMALL', minAttendees: 6, maxAttendees: 8, rateMinor: 3000 },
  { roomKey: 'GROUP_SMALL', minAttendees: 9, maxAttendees: 10, rateMinor: 3500 },
  { roomKey: 'GROUP_LARGE', minAttendees: 3, maxAttendees: 5, rateMinor: 2500 },
  { roomKey: 'GROUP_LARGE', minAttendees: 6, maxAttendees: 9, rateMinor: 3000 },
  { roomKey: 'GROUP_LARGE', minAttendees: 10, maxAttendees: 14, rateMinor: 3500 },
  { roomKey: 'GROUP_LARGE', minAttendees: 15, rateMinor: 4000 },
];

export function resolveGroupSessionRateMinor(
  attendees: number,
  roomKey: GroupRoomKey | undefined,
  tiers: GroupRateTier[] | undefined,
  legacy?: { rateMinor?: number; minAttendees?: number },
): number {
  const table =
    tiers && tiers.length > 0 ? tiers : DEFAULT_GROUP_RATE_TIERS;
  if (roomKey) {
    const match = table.find(
      (t) =>
        t.roomKey === roomKey &&
        attendees >= t.minAttendees &&
        (t.maxAttendees == null || attendees <= t.maxAttendees),
    );
    if (match) return match.rateMinor;
    return 0;
  }
  const min = legacy?.minAttendees ?? 1;
  if (attendees < min) return 0;
  return legacy?.rateMinor ?? 0;
}

export function payTrackForDepartment(
  dept: StaffDepartment,
): StaffPayTrack {
  if (dept === 'ADMIN') return 'ADMIN';
  if (dept === 'SPECIALIST' || dept === 'EXTERNAL') return 'SPA';
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
        shopSalesPercent: 0,
        corporateSalesPercent: 0,
        fixedAdvanceMinor: 0,
      };
    case 'GROUP_TRAINER':
      return {
        track,
        groupSessionRateMinor: 0,
        groupMinAttendees: 1,
        groupPerAttendeeMinor: 0,
        groupRateTiers: DEFAULT_GROUP_RATE_TIERS.map((t) => ({ ...t })),
      };
    case 'SPA':
      return {
        track,
        spaSoldPercent: 0,
        spaQuotaRates: DEFAULT_SPA_QUOTA_RATES.map((r) => ({ ...r })),
        spaPartnerRateMinor: 0,
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
        if (slice.shopSalesPercent)
          chips.push(`${tag}магазин ${formatPercent(slice.shopSalesPercent)}%`);
        if (slice.corporateSalesPercent)
          chips.push(
            `${tag}корпо ${formatPercent(slice.corporateSalesPercent)}%`,
          );
        if (slice.fixedAdvanceMinor)
          chips.push(
            `${tag}аванс 25-е ${money(slice.fixedAdvanceMinor)}`,
          );
        break;
      case 'GROUP_TRAINER':
        if (slice.hourlyRateMinor)
          chips.push(`${tag}${money(slice.hourlyRateMinor)}/ч смены`);
        if (slice.groupRateTiers?.length)
          chips.push(`${tag}тиры×зал (${slice.groupRateTiers.length})`);
        else if (slice.groupSessionRateMinor)
          chips.push(`${tag}занятие ${money(slice.groupSessionRateMinor)}`);
        if (slice.groupMinAttendees && !slice.groupRateTiers?.length)
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
        if (slice.spaPartnerRateMinor)
          chips.push(`${tag}AllSports ${money(slice.spaPartnerRateMinor)}`);
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
