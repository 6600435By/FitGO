/** Role-specific pay / motivation profiles (edited on Staff, used by payroll). */

export type StaffPayTrack =
  | 'ADMIN'
  | 'MANAGER'
  | 'GROUP_TRAINER'
  | 'SPA'
  | 'TECH'
  | 'PT'
  | 'CLUB'
  | 'REFORMER';

/** Staff-tab trainer subdivisions. A trainer may belong to several. */
export type TrainerGroupId = 'GP' | 'STAFF' | 'CLUB' | 'REFORMER';

export const TRAINER_GROUP_TRACK: Record<TrainerGroupId, StaffPayTrack> = {
  GP: 'GROUP_TRAINER',
  STAFF: 'PT',
  CLUB: 'CLUB',
  REFORMER: 'REFORMER',
};

export interface TrainerPayFlags {
  isTrainer: boolean;
  /** Stored choice. Until the first save, untagged trainers count as штат. */
  groupsSet: boolean;
  gp: boolean;
  staff: boolean;
  club: boolean;
  /** Reformer room / individual reformer scheme. */
  reformers: boolean;
}

export function trainerPayFlags(input: {
  roles: readonly string[];
  groupPrograms?: boolean | null;
  trainerStaff?: boolean | null;
  trainerClub?: boolean | null;
  trainerReformers?: boolean | null;
  trainerGroupsSet?: boolean | null;
}): TrainerPayFlags {
  const isTrainer = input.roles.includes('TRAINER');
  const groupsSet = !!input.trainerGroupsSet;
  const gp = !!input.groupPrograms;
  const club = !!input.trainerClub;
  const reformers = !!input.trainerReformers;
  let staff = !!input.trainerStaff;
  if (isTrainer && !groupsSet && !gp && !staff && !club && !reformers)
    staff = true;
  return { isTrainer, groupsSet, gp, staff, club, reformers };
}

/**
 * Pay slices that actually accrue for this person.
 * Штат and клуб both price PT sessions — if both are on, штат wins so % is not doubled.
 * Клуб rates stay stored so they can be copied onto the club group.
 * Reformer pay only when the Reformers flag is on.
 */
export function payProfileForCalculation(
  profile: StaffPayProfile | null | undefined,
  flags: TrainerPayFlags,
): StaffPayProfile | undefined {
  if (!flags.isTrainer) return profile ?? undefined;
  // No saved compensation yet — still seed REFORMER / GP / PT from flags
  // so self-view and club payroll can accrue default reformer hall rates.
  if (!profile) {
    if (!flags.gp && !flags.staff && !flags.club && !flags.reformers) {
      return undefined;
    }
    const seedTrack: StaffPayTrack = flags.reformers
      ? 'REFORMER'
      : flags.gp
        ? 'GROUP_TRAINER'
        : flags.club && !flags.staff
          ? 'CLUB'
          : 'PT';
    return payProfileForCalculation(
      { track: seedTrack, byTrack: {} },
      flags,
    );
  }
  const stored = allPaySlices(profile);
  const hasGroupSlice = stored.some((slice) => slice.track === 'GROUP_TRAINER');
  const hasPtSlice = stored.some((slice) => slice.track === 'PT');
  // GP-only trainers who were still on the PT scheme keep it until a GP scheme is saved.
  const keepLegacyPt =
    flags.gp &&
    !flags.staff &&
    !flags.club &&
    !flags.reformers &&
    !hasGroupSlice &&
    hasPtSlice;
  const slices = stored.filter((slice) => {
    if (slice.track === 'GROUP_TRAINER') return flags.gp;
    if (slice.track === 'PT') return flags.staff || keepLegacyPt;
    if (slice.track === 'CLUB') return flags.club && !flags.staff;
    if (slice.track === 'REFORMER') return flags.reformers;
    return true;
  });
  // Seed / fill REFORMER scheme (empty `track: REFORMER` stub has no tiers).
  if (flags.reformers) {
    const legacyGp = stored.find((s) => s.track === 'GROUP_TRAINER');
    const seeded = defaultPayProfile('REFORMER');
    if (
      legacyGp?.reformerPersonalPercent &&
      !(seeded.reformerPersonalPercent ?? 0)
    ) {
      seeded.reformerPersonalPercent = legacyGp.reformerPersonalPercent;
    }
    const idx = slices.findIndex((s) => s.track === 'REFORMER');
    if (idx < 0) {
      slices.push(seeded);
    } else {
      const existing = slices[idx]!;
      const hasTiers =
        (existing.groupRateTiers?.filter((t) => t.roomKey === 'REFORMER')
          .length ?? 0) > 0;
      if (!hasTiers) {
        slices[idx] = {
          ...seeded,
          ...existing,
          groupRateTiers: seeded.groupRateTiers,
          reformerPersonalPercent:
            existing.reformerPersonalPercent ?? seeded.reformerPersonalPercent,
        };
      }
    }
  }
  if (!slices.length) {
    return {
      track: 'PT',
      ptPercentTiers: [{ minSessions: 0, percent: 0 }],
      hourlyRateMinor: 0,
      fixedAdvanceMinor: 0,
      ptSessionPriceMinor: 0,
    };
  }
  const byTrack: NonNullable<StaffPayProfile['byTrack']> = {};
  for (const slice of slices) byTrack[slice.track] = slice;
  const primary = slices[0]!;
  return { ...primary, track: primary.track, byTrack };
}

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
  /**
   * ADMIN: how membership sales are attributed.
   * `individual` — 100% to document author; `shiftShare` — split across admins on shift that day.
   * MANAGER always uses club-wide totals (ignored).
   */
  membershipSalesAttribution?: 'individual' | 'shiftShare';
  /** ADMIN / MANAGER: % of massage + solarium (доп. услуги). */
  extraSalesPercent?: number;
  /** ADMIN: % of shop / retail sales. */
  shopSalesPercent?: number;
  /** ADMIN / MANAGER: % of manually entered corporate (р/с) sales. */
  corporateSalesPercent?: number;
  /** GROUP: legacy flat rate when attendees >= min (fallback if no tiers). */
  groupSessionRateMinor?: number;
  groupMinAttendees?: number;
  /** Optional per-attendee top-up above min. */
  groupPerAttendeeMinor?: number;
  /** GROUP: attendee × room matrix (preferred). */
  groupRateTiers?: GroupRateTier[];
  /**
   * @deprecated Legacy flat reformer group rate on GROUP_TRAINER.
   * Reformer group pay now uses REFORMER track + groupRateTiers (room REFORMER).
   */
  reformerGroupRateMinor?: number;
  /**
   * REFORMER (legacy also on GROUP_TRAINER): % of per-session price for
   * individual sessions in «Индивидуальные Реформер» nomenclature segment.
   * These sessions do not count toward PT volume tiers.
   */
  reformerPersonalPercent?: number;
  /**
   * Fixed rate per conducted «АСД группа» class when ≥1 attended (minor).
   * Shared across GP and staff schemes — pay once per session.
   */
  asdGroupRateMinor?: number;
  /** SPA: % of sold/rendered paid services. */
  spaSoldPercent?: number;
  /** SPA: fixed rates for membership-package services. */
  spaQuotaRates?: SpaQuotaServiceRate[];
  /**
   * SPA: fixed rate per rendered «Allsports БИОИМПЕДАНС» service (minor).
   * Matched by nomenclature UUID, not partner visit flag.
   */
  spaPartnerRateMinor?: number;
  /** PT: volume tiers for % of paid conducted sessions. */
  ptPercentTiers?: PtPercentTier[];
  /** PT: session catalog price (minor) when booking has no CRM price. */
  ptSessionPriceMinor?: number;
  /**
   * PT / CLUB: fixed rate per conducted paid «Занятие с тренером ALL SPORTS» (minor).
   * Does not enter PT % ladder.
   */
  ptAllSportsRateMinor?: number;
  /**
   * Fixed advance to card on the 25th (days 1–15), minor units.
   * Tracks: ADMIN, MANAGER, SPA, TECH, staff PT, GROUP_TRAINER, REFORMER
   * (one shared value for trainer subdivisions). Deducted once on the 15th via priorPaid.
   */
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
  | 'MANAGER'
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

/** Group or personal session in the reformer hall (room or title). */
export function isReformerHallSession(
  roomTitle?: string | null,
  title?: string | null,
): boolean {
  if (resolveGroupRoomKey(roomTitle) === 'REFORMER') return true;
  if (title && /реформ/i.test(title)) return true;
  return false;
}

/**
 * 1C «АСД Лабс Групповое занятие» nomenclature UUID
 * (e1cib ref 8deca45d36c32cf111f1c24239bba6e9 → dash form used in FitGO).
 * Also accept platform GUID byte-order if 1C emits УникальныйИдентификатор that way.
 */
export const ASD_GROUP_SERVICE_IDS = [
  '8deca45d-36c3-2cf1-11f1-c24239bba6e9',
  '39bba6e9-c242-11f1-8dec-a45d36c32cf1',
] as const;

/**
 * SPA «Allsports БИОИМПЕДАНС»
 * e1cib ref 8de2a45d36c32cf111f1318f3dd9913b
 */
export const SPA_ALLSPORTS_BIOIMPEDANCE_IDS = [
  '8de2a45d-36c3-2cf1-11f1-318f3dd9913b',
  '8de2a45d36c32cf111f1318f3dd9913b',
  '3dd9913b-318f-11f1-8de2-a45d36c32cf1',
] as const;

/**
 * PT «Занятие с тренером ALL SPORTS»
 * e1cib ref 8de2a45d36c32cf111f1318fdac9a158
 */
export const PT_ALLSPORTS_SESSION_IDS = [
  '8de2a45d-36c3-2cf1-11f1-318fdac9a158',
  '8de2a45d36c32cf111f1318fdac9a158',
  'dac9a158-318f-11f1-8de2-a45d36c32cf1',
] as const;

/**
 * 1C segment «Индивидуальные Реформер»
 * e1cib ref 8deca45d36c32cf111f1c6f94643a7d2
 */
export const REFORMER_PERSONAL_SEGMENT_UUID =
  '8deca45d-36c3-2cf1-11f1-c6f94643a7d2';

/** @deprecated Prefer DEFAULT_REFORMER_RATE_TIERS on REFORMER track. */
export const DEFAULT_REFORMER_GROUP_RATE_MINOR = 3500;

/** Club default reformer group tiers (BYN → minor). */
export const DEFAULT_REFORMER_RATE_TIERS: GroupRateTier[] = [
  { roomKey: 'REFORMER', minAttendees: 1, maxAttendees: 2, rateMinor: 3000 },
  { roomKey: 'REFORMER', minAttendees: 3, maxAttendees: 3, rateMinor: 5000 },
  { roomKey: 'REFORMER', minAttendees: 4, rateMinor: 6000 },
];

export function normalizeServiceExternalId(
  raw: string | null | undefined,
): string {
  return (raw ?? '').trim().toLowerCase().replace(/[{}]/g, '');
}

/** Compare 1C nomenclature ids ignoring braces and dashes. */
export function serviceExternalIdsEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeServiceExternalId(a).replace(/-/g, '');
  const nb = normalizeServiceExternalId(b).replace(/-/g, '');
  return Boolean(na && nb && na === nb);
}

export function serviceExternalIdInList(
  raw: string | null | undefined,
  list: readonly string[],
): boolean {
  return list.some((id) => serviceExternalIdsEqual(raw, id));
}

/** Match «АСД группа» by nomenclature UUID or title fallback. */
export function isAsdGroupSession(input: {
  serviceExternalId?: string | null;
  title?: string | null;
}): boolean {
  if (serviceExternalIdInList(input.serviceExternalId, ASD_GROUP_SERVICE_IDS))
    return true;
  const title = (input.title ?? '').toLowerCase();
  return /асд/i.test(title);
}

/** SPA AllSports биоимпеданс — fixed spaPartnerRateMinor. */
export function isSpaAllSportsBioimpedance(input: {
  serviceExternalId?: string | null;
  title?: string | null;
}): boolean {
  if (
    serviceExternalIdInList(
      input.serviceExternalId,
      SPA_ALLSPORTS_BIOIMPEDANCE_IDS,
    )
  )
    return true;
  const title = (input.title ?? '').toLowerCase();
  return /биоимпеданс|bio.?imped/i.test(title);
}

/** PT «Занятие с тренером ALL SPORTS» — fixed ptAllSportsRateMinor. */
export function isPtAllSportsSession(input: {
  serviceExternalId?: string | null;
  title?: string | null;
  serviceName?: string | null;
}): boolean {
  if (serviceExternalIdInList(input.serviceExternalId, PT_ALLSPORTS_SESSION_IDS))
    return true;
  const text = `${input.title ?? ''} ${input.serviceName ?? ''}`.toLowerCase();
  return /занятие с тренер.*all\s*sports|all\s*sports.*занятие с тренер/i.test(
    text,
  );
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
  if (dept === 'MANAGER') return 'MANAGER';
  if (dept === 'SPECIALIST' || dept === 'EXTERNAL') return 'SPA';
  if (dept === 'TECH') return 'TECH';
  return 'PT';
}

export function departmentsForPayTrack(track: StaffPayTrack): StaffDepartment[] {
  if (track === 'ADMIN') return ['ADMIN'];
  if (track === 'MANAGER') return ['MANAGER'];
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

/**
 * «Выплата аванса на карту» from a *stored* pay profile.
 * Call on the raw compensation JSON — not on `payProfileForCalculation` output —
 * otherwise GP filtering can drop the PT/REFORMER slice that holds the amount
 * (admins keep working because non-trainers skip that filter).
 */
export function resolveFixedAdvanceMinor(
  profile: StaffPayProfile | null | undefined,
  roles: readonly string[],
  opts?: { trainerStaff?: boolean },
): number {
  if (!profile) return 0;
  const pick = (track: StaffPayTrack) =>
    sliceForTrack(profile, track).fixedAdvanceMinor ?? 0;
  const root = profile.fixedAdvanceMinor ?? 0;
  const anySlice =
    allPaySlices(profile)
      .map((slice) => slice.fixedAdvanceMinor ?? 0)
      .find((n) => n > 0) ?? 0;

  const ordered: number[] = [];
  if (roles.includes('MANAGER')) ordered.push(pick('MANAGER') || root);
  if (roles.includes('ADMIN')) ordered.push(pick('ADMIN') || root);
  if (roles.includes('SPECIALIST')) ordered.push(pick('SPA') || root);
  if (roles.includes('TECH')) ordered.push(pick('TECH') || root);
  if (roles.includes('TRAINER')) {
    ordered.push(
      pick('PT') || pick('GROUP_TRAINER') || pick('REFORMER') || root,
    );
  }

  const firstPositive = ordered.find((n) => n > 0);
  if (firstPositive != null) return firstPositive;
  if (anySlice > 0) return anySlice;

  // ADMIN / staff PT with explicit 0 still use the fixed path (earned = 0).
  if (roles.includes('ADMIN') || opts?.trainerStaff) return 0;
  return root;
}

/**
 * ADVANCE_HALF (25th) accrual profile: drop PT / CLUB / REFORMER so only
 * GP group rates (and non-trainer slices) earn for days 1–15.
 * Reformer and staff PT settle on the 15th.
 */
export function payProfileForAdvanceHalf(
  profile: StaffPayProfile | null | undefined,
  flags: TrainerPayFlags,
): StaffPayProfile | undefined {
  const base = payProfileForCalculation(profile, flags);
  if (!base) return undefined;
  if (!flags.isTrainer) return base;
  const slices = allPaySlices(base).filter((slice) => {
    if (slice.track === 'REFORMER') return false;
    if (slice.track === 'PT' || slice.track === 'CLUB') return false;
    if (slice.track === 'GROUP_TRAINER') return flags.gp;
    return true;
  });
  if (!slices.length) {
    return {
      track: 'GROUP_TRAINER',
      groupSessionRateMinor: 0,
      groupMinAttendees: 1,
      fixedAdvanceMinor:
        sliceForTrack(base, 'GROUP_TRAINER').fixedAdvanceMinor ||
        sliceForTrack(base, 'PT').fixedAdvanceMinor ||
        sliceForTrack(base, 'REFORMER').fixedAdvanceMinor ||
        base.fixedAdvanceMinor ||
        0,
    };
  }
  const byTrack: NonNullable<StaffPayProfile['byTrack']> = {};
  for (const slice of slices) byTrack[slice.track] = slice;
  const primary = slices[0]!;
  return { ...primary, track: primary.track, byTrack };
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
        // Club default: split membership by FitGO admin roster (1 → 100%, 2+ → equal).
        membershipSalesAttribution: 'shiftShare',
        extraSalesPercent: 0,
        shopSalesPercent: 0,
        corporateSalesPercent: 0,
        fixedAdvanceMinor: 0,
      };
    case 'MANAGER':
      return {
        track,
        membershipSalesPercent: 0,
        extraSalesPercent: 0,
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
        asdGroupRateMinor: 0,
        fixedAdvanceMinor: 0,
      };
    case 'REFORMER':
      return {
        track,
        groupRateTiers: DEFAULT_REFORMER_RATE_TIERS.map((t) => ({ ...t })),
        reformerPersonalPercent: 0,
        fixedAdvanceMinor: 0,
      };
    case 'SPA':
      return {
        track,
        spaSoldPercent: 0,
        spaQuotaRates: DEFAULT_SPA_QUOTA_RATES.map((r) => ({ ...r })),
        spaPartnerRateMinor: 0,
        fixedAdvanceMinor: 0,
      };
    case 'TECH':
      return {
        track,
        hourlyRateMinor: 0,
        fixedAdvanceMinor: 0,
        notes: 'Премии и штрафы — отдельными корректировками в расчёте ЗП',
      };
    case 'PT':
      return {
        track,
        ptPercentTiers: DEFAULT_PT_TIERS.map((t) => ({ ...t })),
        ptSessionPriceMinor: 0,
        ptAllSportsRateMinor: 0,
        hourlyRateMinor: 0,
        fixedAdvanceMinor: 0,
        asdGroupRateMinor: 0,
      };
    case 'CLUB':
      return {
        track,
        ptPercentTiers: DEFAULT_PT_TIERS.map((t) => ({ ...t })),
        ptSessionPriceMinor: 0,
        ptAllSportsRateMinor: 0,
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
  const sliceCount = allPaySlices(profile).length;
  for (const slice of allPaySlices(profile)) {
    const tag =
      sliceCount > 1
        ? slice.track === 'GROUP_TRAINER'
          ? 'ГП: '
          : slice.track === 'PT'
            ? 'штат: '
            : slice.track === 'CLUB'
              ? 'клуб: '
              : slice.track === 'REFORMER'
                ? 'реформер: '
                : `${slice.track}: `
        : '';
    switch (slice.track) {
      case 'ADMIN':
        if (slice.hourlyRateMinor)
          chips.push(`${tag}${money(slice.hourlyRateMinor)}/ч`);
        if (slice.membershipSalesPercent) {
          const mode =
            slice.membershipSalesAttribution === 'shiftShare'
              ? 'по графику'
              : 'кто продал';
          chips.push(
            `${tag}абн. ${formatPercent(slice.membershipSalesPercent)}% (${mode})`,
          );
        }
        if (slice.extraSalesPercent)
          chips.push(
            `${tag}массаж/солярий ${formatPercent(slice.extraSalesPercent)}%`,
          );
        if (slice.shopSalesPercent)
          chips.push(`${tag}магазин ${formatPercent(slice.shopSalesPercent)}%`);
        if (slice.corporateSalesPercent)
          chips.push(
            `${tag}корпо ${formatPercent(slice.corporateSalesPercent)}%`,
          );
        if (slice.fixedAdvanceMinor)
          chips.push(
            `${tag}аванс на карту 25-е ${money(slice.fixedAdvanceMinor)}`,
          );
        break;
      case 'MANAGER':
        if (slice.membershipSalesPercent)
          chips.push(
            `${tag}абн. клуба ${formatPercent(slice.membershipSalesPercent)}%`,
          );
        if (slice.extraSalesPercent)
          chips.push(
            `${tag}доп клуба ${formatPercent(slice.extraSalesPercent)}%`,
          );
        if (slice.corporateSalesPercent)
          chips.push(
            `${tag}корпо ${formatPercent(slice.corporateSalesPercent)}%`,
          );
        if (slice.fixedAdvanceMinor)
          chips.push(
            `${tag}аванс на карту 25-е ${money(slice.fixedAdvanceMinor)}`,
          );
        chips.push(`${tag}± премия/штраф`);
        break;
      case 'GROUP_TRAINER':
        if (slice.hourlyRateMinor)
          chips.push(`${tag}${money(slice.hourlyRateMinor)}/ч смены`);
        if (slice.groupRateTiers?.length) {
          const roomLabel: Record<GroupRoomKey, string> = {
            GROUP_SMALL: 'малый',
            GROUP_LARGE: 'большой',
            GYM: 'тренаж',
            REFORMER: 'реформер',
          };
          const order: GroupRoomKey[] = [
            'GROUP_SMALL',
            'GROUP_LARGE',
            'GYM',
          ];
          for (const room of order) {
            const rows = slice.groupRateTiers.filter((t) => t.roomKey === room);
            if (!rows.length) continue;
            const parts = rows.map((t) => {
              const span =
                t.maxAttendees == null
                  ? `${t.minAttendees}+`
                  : `${t.minAttendees}–${t.maxAttendees}`;
              return `${span}: ${money(t.rateMinor)}`;
            });
            chips.push(`${tag}${roomLabel[room]} ${parts.join(', ')}`);
          }
        } else if (slice.groupSessionRateMinor)
          chips.push(`${tag}занятие ${money(slice.groupSessionRateMinor)}`);
        if (slice.groupMinAttendees && !slice.groupRateTiers?.length)
          chips.push(`${tag}от ${slice.groupMinAttendees} чел.`);
        if (slice.groupPerAttendeeMinor)
          chips.push(`${tag}+${money(slice.groupPerAttendeeMinor)}/чел`);
        if (slice.asdGroupRateMinor)
          chips.push(`${tag}АСД ${money(slice.asdGroupRateMinor)}`);
        if (slice.fixedAdvanceMinor)
          chips.push(
            `${tag}аванс на карту 25-е ${money(slice.fixedAdvanceMinor)}`,
          );
        break;
      case 'REFORMER': {
        const tiers =
          slice.groupRateTiers?.filter((t) => t.roomKey === 'REFORMER') ?? [];
        if (tiers.length) {
          const parts = tiers.map((t) => {
            const span =
              t.maxAttendees == null
                ? `${t.minAttendees}+`
                : `${t.minAttendees}–${t.maxAttendees}`;
            return `${span}: ${money(t.rateMinor)}`;
          });
          chips.push(`${tag}гр. ${parts.join(', ')}`);
        }
        if (slice.reformerPersonalPercent)
          chips.push(
            `${tag}инд. ${formatPercent(slice.reformerPersonalPercent)}%`,
          );
        if (slice.fixedAdvanceMinor)
          chips.push(
            `${tag}аванс на карту 25-е ${money(slice.fixedAdvanceMinor)}`,
          );
        break;
      }
      case 'SPA':
        if (slice.spaSoldPercent)
          chips.push(`${tag}услуги ${formatPercent(slice.spaSoldPercent)}%`);
        for (const r of slice.spaQuotaRates ?? []) {
          if (r.rateMinor > 0)
            chips.push(`${tag}${r.label}: ${money(r.rateMinor)}`);
        }
        if (slice.spaPartnerRateMinor)
          chips.push(
            `${tag}биоимпеданс ${money(slice.spaPartnerRateMinor)}`,
          );
        if (slice.fixedAdvanceMinor)
          chips.push(
            `${tag}аванс на карту 25-е ${money(slice.fixedAdvanceMinor)}`,
          );
        break;
      case 'TECH':
        if (slice.hourlyRateMinor)
          chips.push(`${tag}${money(slice.hourlyRateMinor)}/ч`);
        else chips.push(`${tag}часы`);
        if (slice.fixedAdvanceMinor)
          chips.push(
            `${tag}аванс на карту 25-е ${money(slice.fixedAdvanceMinor)}`,
          );
        chips.push(`${tag}± премия/штраф`);
        break;
      case 'PT':
        if (slice.hourlyRateMinor)
          chips.push(`${tag}${money(slice.hourlyRateMinor)}/ч смены`);
        if (slice.fixedAdvanceMinor)
          chips.push(
            `${tag}аванс на карту 25-е ${money(slice.fixedAdvanceMinor)}`,
          );
        if (slice.ptSessionPriceMinor)
          chips.push(`${tag}ПТ ${money(slice.ptSessionPriceMinor)}`);
        if (slice.ptAllSportsRateMinor)
          chips.push(
            `${tag}ALL SPORTS ${money(slice.ptAllSportsRateMinor)}`,
          );
        for (const t of slice.ptPercentTiers ?? []) {
          chips.push(`${tag}≥${t.minSessions}: ${formatPercent(t.percent)}%`);
        }
        if (slice.asdGroupRateMinor)
          chips.push(`${tag}АСД ${money(slice.asdGroupRateMinor)}`);
        break;
      case 'CLUB':
        if (slice.ptSessionPriceMinor)
          chips.push(`${tag}ПТ ${money(slice.ptSessionPriceMinor)}`);
        if (slice.ptAllSportsRateMinor)
          chips.push(
            `${tag}ALL SPORTS ${money(slice.ptAllSportsRateMinor)}`,
          );
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

/**
 * Pack discount for SPA massage blocks when sale amount is unknown.
 * Block of 5 → 5%, block of 10 → 10%; other N → N% clamped to 0…10.
 */
export function spaBlockDiscountPct(visitCount: number): number {
  const n = Math.round(Number(visitCount) || 0);
  if (n <= 0) return 0;
  if (n === 5) return 5;
  if (n === 10) return 10;
  return Math.min(10, Math.max(0, n));
}

/**
 * Visit count encoded in pack nomenclature / paymentBasis.
 * Examples: «10 ПТ (50р.)», «Индивидуальное занятие реформер 8», «Курс массажа 5».
 * Returns null when the title is not a countable multi/single pack label.
 */
export function parsePackVisitCountFromTitle(
  title: string | null | undefined,
): number | null {
  const s = (title ?? '').trim().toLowerCase();
  if (!s) return null;
  // Avoid \\b — JS word boundaries ignore Cyrillic letters.
  let m = s.match(/(?:^|[^\d])(\d{1,3})\s*пт(?![a-zа-яё])/);
  if (m) {
    const n = Number(m[1]);
    return n > 0 ? n : null;
  }
  m = s.match(/реформер\s*(\d{1,3})(?![0-9])/);
  if (m) {
    const n = Number(m[1]);
    return n > 0 ? n : null;
  }
  m = s.match(/курс\s+массаж[ае]?\s*(\d{1,3})(?![0-9])/);
  if (m) {
    const n = Number(m[1]);
    return n > 0 ? n : null;
  }
  // «Блок массажа 10 новый», «массаж 10», «массажа 5 занятий»
  m = s.match(
    /(?:блок\s+)?массаж[а]?\s+(\d{1,3})\s*(?:занят|сеанс|визит|шт|нов)?/,
  );
  if (m) {
    const n = Number(m[1]);
    return n > 0 ? n : null;
  }
  return null;
}

/**
 * Pack SKU inside paymentBasis like
 * `Пакет услуг "Индивидуальное занятие реформер 8" 73437 от 08.10.2026`
 * or with «ёлочки» `Пакет услуг «Блок массажа 10 новый» …`.
 */
export function extractQuotedPackNameFromBasis(
  paymentBasis: string | null | undefined,
): string | null {
  const s = (paymentBasis ?? '').trim();
  if (!s) return null;
  const m =
    s.match(/«([^»]+)»/) ||
    s.match(/"([^"]+)"/) ||
    s.match(/“([^”]+)”/);
  const name = m?.[1]?.trim();
  return name || null;
}

/**
 * 1C often stores massage / bioimpedance appointments as kind=PT.
 * Reclassify to SPA payroll when the title is clearly a spa service.
 */
export function isSpaLikeSessionTitle(
  title: string | null | undefined,
): boolean {
  const s = (title ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return false;
  if (/массаж|massage/.test(s)) return true;
  if (/биоимпеданс|bioimped|inbody/.test(s)) return true;
  if (/состав.*тел|композиц/.test(s)) return true;
  if (/(?:^|[^a-zа-я])спа(?:[^a-zа-я]|$)|(?:^|[^a-z])spa(?:[^a-z]|$)/.test(s))
    return true;
  return false;
}

/** Pack document date from basis (`от 08.10.2026` / `от 08.10.26`). */
export function extractPackDateIsoFromBasis(
  paymentBasis: string | null | undefined,
): string | null {
  const s = (paymentBasis ?? '').trim();
  if (!s) return null;
  const m = s.match(/от\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})/i);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  let yyyy = Number(m[3]);
  if (yyyy < 100) yyyy += 2000;
  if (!dd || !mm || !yyyy) return null;
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/**
 * Listed per-visit price in major BYN from titles like «10 ПТ (50р.)»
 * or «Занятие с тренером 35р.».
 */
export function parseListedUnitPriceMajor(
  title: string | null | undefined,
): number | null {
  const s = (title ?? '').trim();
  if (!s) return null;
  const paren = s.match(/\((\d+(?:[.,]\d+)?)\s*р/i);
  if (paren) {
    const n = Number(paren[1].replace(',', '.'));
    return n > 0 ? n : null;
  }
  const trailing = s.match(/(\d+(?:[.,]\d+)?)\s*р\.?\s*$/i);
  if (trailing) {
    const n = Number(trailing[1].replace(',', '.'));
    return n > 0 ? n : null;
  }
  return null;
}

/**
 * True when a sale line is a multi-visit pack (pay only on conducted write-offs).
 * Single-visit / one-shot PT sales stay payable at sale time.
 */
export function isMultiVisitPackSale(
  serviceName: string | null | undefined,
  quantity?: number | null,
): boolean {
  if (quantity != null && Number(quantity) > 1) return true;
  const fromName = parsePackVisitCountFromTitle(serviceName);
  return fromName != null && fromName > 1;
}

/**
 * Classify conducted PT funding for timesheet stats.
 * 1C `paySource` is often PACKAGE whenever paymentBasis is set — use basis text.
 */
export function classifyPtSessionOrigin(input: {
  paymentBasis?: string | null;
  sessionTitle?: string | null;
  packageQty?: number | null;
  /** True when the row comes from a one-shot TrainerPtSale (not a class write-off). */
  fromSaleLine?: boolean;
  isComplimentary?: boolean;
}): import('./pt-timesheet').PtStatsOrigin {
  if (
    input.isComplimentary ||
    isComplimentarySessionTitle(input.paymentBasis) ||
    isComplimentarySessionTitle(input.sessionTitle)
  ) {
    return 'GIFT';
  }
  if (input.fromSaleLine) return 'ONE_SHOT';

  const basis = (input.paymentBasis ?? '').trim();
  if (!basis) return 'UNKNOWN';

  const lower = basis
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
  if (/подарок|gift|комплимент|бесплат/.test(lower)) return 'GIFT';

  const quoted = extractQuotedPackNameFromBasis(basis)?.toLowerCase() ?? '';
  const title = (quoted || lower).replace(/ё/g, 'е');

  // Countable multi-visit packs first («Блок массажа 10», «Курс массажа 5»,
  // «10 ПТ») — even when 1C wraps them as «Членство …». Otherwise SPA payroll
  // treats them as VIP-included quota (fixed spaQuotaRates).
  const packCount =
    parsePackVisitCountFromTitle(basis) ??
    parsePackVisitCountFromTitle(quoted) ??
    parsePackVisitCountFromTitle(input.sessionTitle) ??
    (input.packageQty != null && input.packageQty > 0
      ? input.packageQty
      : null);
  if (packCount != null && packCount > 1) return 'BLOCK';
  if (packCount === 1 && (lower.includes('пакет услуг') || /пт|реформер|массаж/.test(title))) {
    return 'ONE_SHOT';
  }

  const isVip =
    /^vip\b/.test(title) ||
    title.startsWith('vip(') ||
    title.startsWith('vip ');
  const membershipHint =
    lower.startsWith('членств') ||
    (lower.includes('членств') && !lower.includes('пакет услуг')) ||
    isVip ||
    title.includes('единый') ||
    title.includes('безлимит') ||
    title.includes('все включено') ||
    title.includes('легкий старт');
  if (membershipHint) return 'MEMBERSHIP';

  if (lower.includes('пакет услуг') || packCount != null) {
    if (packCount === 1) return 'ONE_SHOT';
    if (lower.includes('пакет услуг')) return 'BLOCK';
  }

  if (/долг|рассроч/.test(lower)) return 'ONE_SHOT';
  if (/оплач|нал|карт|безнал|лс|лицевой|продаж/.test(lower)) {
    return 'ONE_SHOT';
  }
  if (/абонемент|квот/.test(lower)) return 'MEMBERSHIP';

  return 'UNKNOWN';
}

/** Settlement label for a stats line (axis separate from origin). */
export function classifyPtStatsPayment(input: {
  origin: import('./pt-timesheet').PtStatsOrigin;
  paymentBasis?: string | null;
  isComplimentary?: boolean;
  /** Sale line paymentStatus when from TrainerPtSale. */
  salePaymentStatus?: string | null;
  payrollTrusted?: boolean;
}): import('./pt-timesheet').PtStatsPayment {
  if (
    input.isComplimentary ||
    input.origin === 'GIFT' ||
    isComplimentarySessionTitle(input.paymentBasis)
  ) {
    return 'GIFT';
  }
  const sale = (input.salePaymentStatus ?? '').toUpperCase();
  if (sale === 'DEBT' || sale === 'UNPAID') return 'DEBT';
  if (sale === 'PAID') return 'PAID';

  const basis = (input.paymentBasis ?? '').trim().toLowerCase();
  if (/долг|рассроч/.test(basis)) return 'DEBT';
  if (input.origin === 'MEMBERSHIP' || input.origin === 'BLOCK') {
    return 'WRITTEN_OFF';
  }
  if (input.origin === 'ONE_SHOT') {
    if (input.payrollTrusted === false) return 'DEBT';
    return 'PAID';
  }
  if (!basis) return 'UNKNOWN';
  if (/оплач|нал|карт|безнал|лс|лицевой|продаж/.test(basis)) return 'PAID';
  return 'UNKNOWN';
}

export function isComplimentarySessionTitle(
  title: string | null | undefined,
): boolean {
  return /подароч|gift|комплимент|бесплат/i.test(title ?? '');
}

export type PackageUnitPriceInput = {
  unitPriceMinor?: number | null;
  packageAmountMinor?: number | null;
  packageQty?: number | null;
  /** 1C paymentBasis / package presentation. */
  paymentBasis?: string | null;
  /** Conducted session / service title. */
  sessionTitle?: string | null;
};

/**
 * Per-conducted-visit price (minor) for PT / reformer / SPA pack write-offs.
 * Prefer 1C unit → listed unit in basis/title → packageAmount/qty for countable
 * packs only («N ПТ», «реформер N», «курс массажа N») — never VIP membership ÷ all quotas.
 */
export function resolvePackageUnitPriceMinor(
  input: PackageUnitPriceInput,
): number | undefined {
  const unit = input.unitPriceMinor ?? 0;
  if (unit > 0) return Math.round(unit);

  const listedMajor =
    parseListedUnitPriceMajor(input.paymentBasis) ??
    parseListedUnitPriceMajor(input.sessionTitle);
  if (listedMajor != null && listedMajor > 0) {
    return Math.round(listedMajor * 100);
  }

  const countableQty =
    parsePackVisitCountFromTitle(input.paymentBasis) ??
    parsePackVisitCountFromTitle(input.sessionTitle);
  if (countableQty == null || countableQty <= 0) return undefined;

  const pkgAmt = input.packageAmountMinor ?? 0;
  const qty =
    input.packageQty != null && input.packageQty > 0
      ? input.packageQty
      : countableQty;
  if (pkgAmt > 0 && qty > 0) return Math.round(pkgAmt / qty);
  return undefined;
}
