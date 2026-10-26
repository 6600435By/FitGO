import type {
  MembershipEconomicsSettings,
  MembershipFamilyConfig,
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
    solariumMinuteCostMinor: null,
    personalAccountCogsShare: 0.35,
    overheadPerVisitMinor: 0,
    normVisitsPerWeek: 2,
    segmentThresholds: {
      max: 1.2,
      normal: 0.6,
      under: 0.2,
    },
    sleepingDays: 21,
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
            ...DEFAULT_MEMBERSHIP_FAMILIES[0],
            ...f,
            namePatterns: Array.isArray(f.namePatterns)
              ? f.namePatterns.map(String)
              : ['vip'],
          }))
        : base.families,
    segmentThresholds: {
      ...base.segmentThresholds,
      ...(o.segmentThresholds ?? {}),
    },
  };
}
