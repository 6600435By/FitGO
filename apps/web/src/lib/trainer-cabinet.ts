/** Trainer app shell / nav derived from staff profile group flags. */

export type TrainerCabinetFlags = {
  groupPrograms?: boolean | null;
  trainerStaff?: boolean | null;
  trainerClub?: boolean | null;
  trainerReformers?: boolean | null;
};

export type TrainerCabinetMode = {
  /** GP shell (dark chrome): group programs or reformers. */
  groupCabinet: boolean;
  isGp: boolean;
  isReformer: boolean;
  /** Explicit PT groups (staff / club). */
  hasPt: boolean;
  /** Legacy account with no trainer groups set — show both surfaces. */
  isLegacy: boolean;
  /** Show GP schedule / journal surfaces. */
  showGp: boolean;
  /** Show PT calendar / timesheet / CRM. */
  showPt: boolean;
  /** Payroll menu entry (club salary). */
  showPayroll: boolean;
  /** Personal ledger «Мои оплаты» for trainerClub. */
  showOwnLedger: boolean;
  /** Messages like pure GP (no client chat). */
  groupOnlyMessaging: boolean;
};

export function trainerCabinetMode(
  flags: TrainerCabinetFlags | null | undefined,
): TrainerCabinetMode {
  const isGp = Boolean(flags?.groupPrograms);
  const isReformer = Boolean(flags?.trainerReformers);
  const hasPt = Boolean(flags?.trainerStaff || flags?.trainerClub);
  const groupCabinet = isGp || isReformer;
  const isLegacy = !isGp && !isReformer && !hasPt;
  const showGp = groupCabinet || isLegacy;
  const showPt = hasPt || isLegacy;
  const showPayroll = isGp || isReformer || Boolean(flags?.trainerStaff);
  const showOwnLedger = Boolean(flags?.trainerClub);
  const groupOnlyMessaging = groupCabinet && !hasPt;

  return {
    groupCabinet,
    isGp,
    isReformer,
    hasPt,
    isLegacy,
    showGp,
    showPt,
    showPayroll,
    showOwnLedger,
    groupOnlyMessaging,
  };
}

/** Primary schedule href for Forma Coach dock (unified screen comes in stage 6). */
export function trainerScheduleHref(mode: TrainerCabinetMode): string {
  if (mode.showPt) return '/trainer/schedule';
  return '/trainer/gp-schedule';
}

/** Dock «Клиенты» vs «Контроль» for pure GP. */
export function trainerCrmOrControlHref(mode: TrainerCabinetMode): {
  href: string;
  label: string;
} {
  if (mode.showPt) return { href: '/trainer/clients', label: 'Клиенты' };
  return { href: '/trainer/my-sessions', label: 'Контроль' };
}

/** PT-only routes hidden in the pure group cabinet (GP / reformers). */
export const TRAINER_PT_ONLY_PATHS = [
  '/trainer/schedule',
  '/trainer/clients',
  '/trainer/pt-timesheet',
  '/trainer/shifts',
  '/trainer/group-journal',
] as const;

export function isTrainerPtOnlyPath(pathname: string): boolean {
  return TRAINER_PT_ONLY_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}
