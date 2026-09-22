/** Role-specific pay / motivation profiles (edited on Staff, used by payroll). */

export type StaffPayTrack =
  | 'ADMIN'
  | 'GROUP_TRAINER'
  | 'SPA'
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
  /** ADMIN: hourly rate (minor). */
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
  notes?: string;
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
    case 'PT':
      return {
        track,
        ptPercentTiers: DEFAULT_PT_TIERS.map((t) => ({ ...t })),
        ptSessionPriceMinor: 0,
        hourlyRateMinor: 0,
      };
  }
}

export function payProfileSummary(profile: StaffPayProfile | null | undefined): string[] {
  if (!profile) return ['Ставки не заданы'];
  const chips: string[] = [];
  switch (profile.track) {
    case 'ADMIN':
      if (profile.hourlyRateMinor)
        chips.push(`${(profile.hourlyRateMinor / 100).toFixed(0)}/ч`);
      if (profile.membershipSalesPercent)
        chips.push(`абн. ${profile.membershipSalesPercent}%`);
      if (profile.extraSalesPercent)
        chips.push(`доп. ${profile.extraSalesPercent}%`);
      break;
    case 'GROUP_TRAINER':
      if (profile.groupSessionRateMinor)
        chips.push(
          `занятие ${(profile.groupSessionRateMinor / 100).toFixed(0)}`,
        );
      if (profile.groupMinAttendees)
        chips.push(`от ${profile.groupMinAttendees} чел.`);
      if (profile.groupPerAttendeeMinor)
        chips.push(
          `+${(profile.groupPerAttendeeMinor / 100).toFixed(0)}/чел`,
        );
      break;
    case 'SPA':
      if (profile.spaSoldPercent) chips.push(`услуги ${profile.spaSoldPercent}%`);
      for (const r of profile.spaQuotaRates ?? []) {
        if (r.rateMinor > 0)
          chips.push(`${r.label}: ${(r.rateMinor / 100).toFixed(0)}`);
      }
      break;
    case 'PT':
      if (profile.hourlyRateMinor)
        chips.push(`${(profile.hourlyRateMinor / 100).toFixed(0)}/ч смены`);
      if (profile.ptSessionPriceMinor)
        chips.push(
          `ПТ ${(profile.ptSessionPriceMinor / 100).toFixed(0)}`,
        );
      for (const t of profile.ptPercentTiers ?? []) {
        chips.push(`≥${t.minSessions}: ${t.percent}%`);
      }
      break;
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
