import type {
  MembershipEconomicsSettings,
  MembershipFamilyConfig,
  MembershipPayrollHints,
} from '@fitgo/shared-types';

export const DEFAULT_MEMBERSHIP_FAMILIES: MembershipFamilyConfig[] = [
  {
    id: 'vip',
    label: 'VIP',
    namePatterns: ['vip'],
    defaultMonths: 1,
    includesGp: true,
    includesGym: true,
    massageQuotaPerMonth: 4,
    solariumMinutesPerMonth: 60,
    personalAccountPerMonthMajor: 16,
  },
  {
    id: 'ediny',
    label: 'Единый',
    namePatterns: ['единый'],
    defaultMonths: 1,
    includesGp: true,
    includesGym: true,
    massageQuotaPerMonth: 0,
    solariumMinutesPerMonth: 0,
    personalAccountPerMonthMajor: 0,
  },
  {
    id: 'vse_vklyucheno',
    label: 'Все включено',
    namePatterns: ['все включено'],
    defaultMonths: 1,
    includesGp: true,
    includesGym: true,
    massageQuotaPerMonth: 4,
    solariumMinutesPerMonth: 60,
    personalAccountPerMonthMajor: 16,
  },
];

export function defaultMembershipEconomicsSettings(): MembershipEconomicsSettings {
  return {
    families: DEFAULT_MEMBERSHIP_FAMILIES.map((f) => ({
      ...f,
      namePatterns: [...f.namePatterns],
    })),
    massageRetailMinor: null,
    solariumMinuteRetailMinor: null,
    massageCostMinor: null,
    bodyCompositionCostMinor: null,
    ptGiftCostMinor: null,
    solariumMinuteCostMinor: null,
    personalAccountCogsShare: 0.35,
    overheadPerVisitMinor: 0,
    gymVisitVariableCostMinor: 0,
    fixedOverheadPerMemberMonthMinor: 0,
    salesCommissionPctOverride: null,
    acquiringPct: 0,
    taxPct: 0,
    gpCostMethod: 'share',
    normVisitsPerWeek: 2.5,
    segmentThresholds: {
      max: 1.2,
      normal: 0.6,
      under: 0.2,
    },
    sleepingDays: 21,
  };
}

export function emptyPayrollHints(): MembershipPayrollHints {
  return {
    avgAdminMembershipSalesPct: null,
    avgManagerMembershipSalesPct: null,
    combinedSalesCommissionPct: null,
    spaMassageRateMinor: null,
    spaBodyCompositionRateMinor: null,
    ptGiftRateMinor: null,
    source: 'payroll',
  };
}

export function mergeMembershipSettings(
  raw: unknown,
): MembershipEconomicsSettings {
  const base = defaultMembershipEconomicsSettings();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Partial<MembershipEconomicsSettings>;
  return {
    ...base,
    ...o,
    families:
      Array.isArray(o.families) && o.families.length > 0
        ? o.families.map((f) => ({
            // Neutral base — do NOT inherit VIP quotas / patterns.
            id: String(f.id ?? 'custom'),
            label: String(f.label ?? 'Абонемент'),
            namePatterns: Array.isArray(f.namePatterns)
              ? f.namePatterns.map(String)
              : [],
            defaultMonths: Number(f.defaultMonths) > 0 ? Number(f.defaultMonths) : 1,
            includesGp: f.includesGp !== false,
            includesGym: f.includesGym !== false,
            massageQuotaPerMonth: Number(f.massageQuotaPerMonth) || 0,
            solariumMinutesPerMonth: Number(f.solariumMinutesPerMonth) || 0,
            personalAccountPerMonthMajor:
              Number(f.personalAccountPerMonthMajor) || 0,
          }))
        : base.families,
    segmentThresholds: {
      ...base.segmentThresholds,
      ...(o.segmentThresholds ?? {}),
    },
    gpCostMethod: o.gpCostMethod === 'marginal' ? 'marginal' : 'share',
    salesCommissionPctOverride:
      o.salesCommissionPctOverride === undefined
        ? base.salesCommissionPctOverride
        : o.salesCommissionPctOverride,
  };
}

/** Infer soft group label from product name (legacy family patterns). */
export function inferGroupLabel(name: string): string | null {
  const n = name.toLowerCase().replace(/ё/g, 'е');
  for (const f of DEFAULT_MEMBERSHIP_FAMILIES) {
    for (const p of f.namePatterns) {
      if (n.includes(p.toLowerCase())) return f.label;
    }
  }
  return null;
}
