/** Role-specific pay / motivation profiles (edited on Staff, used by payroll). */

export type StaffPayTrack =
  | 'ADMIN'
  | 'MANAGER'
  | 'GROUP_TRAINER'
  | 'SPA'
  | 'TECH'
  | 'PT'
  | 'CLUB';

/** Staff-tab trainer subdivisions. A trainer may belong to several. */
export type TrainerGroupId = 'GP' | 'STAFF' | 'CLUB';

export const TRAINER_GROUP_TRACK: Record<TrainerGroupId, StaffPayTrack> = {
  GP: 'GROUP_TRAINER',
  STAFF: 'PT',
  CLUB: 'CLUB',
};

export interface TrainerPayFlags {
  isTrainer: boolean;
  /** Stored choice. Until the first save, untagged trainers count as штат. */
  groupsSet: boolean;
  gp: boolean;
  staff: boolean;
  club: boolean;
}

export function trainerPayFlags(input: {
  roles: readonly string[];
  groupPrograms?: boolean | null;
  trainerStaff?: boolean | null;
  trainerClub?: boolean | null;
  trainerGroupsSet?: boolean | null;
}): TrainerPayFlags {
  const isTrainer = input.roles.includes('TRAINER');
  const groupsSet = !!input.trainerGroupsSet;
  const gp = !!input.groupPrograms;
  const club = !!input.trainerClub;
  let staff = !!input.trainerStaff;
  if (isTrainer && !groupsSet && !gp && !staff && !club) staff = true;
  return { isTrainer, groupsSet, gp, staff, club };
}

/**
 * Pay slices that actually accrue for this person.
 * Штат and клуб both price PT sessions — if both are on, штат wins so % is not doubled.
 * Клуб rates stay stored so they can be copied onto the club group.
 */
export function payProfileForCalculation(
  profile: StaffPayProfile | null | undefined,
  flags: TrainerPayFlags,
): StaffPayProfile | undefined {
  if (!profile) return undefined;
  if (!flags.isTrainer) return profile;
  const stored = allPaySlices(profile);
  const hasGroupSlice = stored.some((slice) => slice.track === 'GROUP_TRAINER');
  const hasPtSlice = stored.some((slice) => slice.track === 'PT');
  // GP-only trainers who were still on the PT scheme keep it until a GP scheme is saved.
  const keepLegacyPt = flags.gp && !flags.staff && !flags.club && !hasGroupSlice && hasPtSlice;
  const slices = stored.filter((slice) => {
    if (slice.track === 'GROUP_TRAINER') return flags.gp;
    if (slice.track === 'PT') return flags.staff || keepLegacyPt;
    if (slice.track === 'CLUB') return flags.club && !flags.staff;
    return true;
  });
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
  /**
   * ADMIN: unpaid seller debts do not enter desk motivation (paid-only).
   * When true (default), overdue unpaid (>7d) is surfaced on payroll as a hold hint.
   */
  considerDebtsInMotivation?: boolean;
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
        considerDebtsInMotivation: true,
      };
    case 'MANAGER':
      return {
        track,
        membershipSalesPercent: 0,
        extraSalesPercent: 0,
        corporateSalesPercent: 0,
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
    case 'CLUB':
      return {
        track,
        ptPercentTiers: DEFAULT_PT_TIERS.map((t) => ({ ...t })),
        ptSessionPriceMinor: 0,
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
            `${tag}аванс 25-е ${money(slice.fixedAdvanceMinor)}`,
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
            'REFORMER',
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
      case 'CLUB':
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
