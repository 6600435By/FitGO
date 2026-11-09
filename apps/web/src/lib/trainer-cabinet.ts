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
  /** Show PT calendar / CRM. */
  showPt: boolean;
  /** «Табель ПТ» — только штатный ПТ (не «Тренер клуб»). */
  showTimesheet: boolean;
  /** Журнал / контроль записей (штатный ПТ, legacy, или «Тренер клуб»). */
  showPtControl: boolean;
  /** Payroll menu entry (club salary). */
  showPayroll: boolean;
  /** Personal ledger «Расчёты» for trainerClub. */
  showOwnLedger: boolean;
  /**
   * Compact dock for pure «Тренер клуб»:
   * Сегодня / Расписание / + / Расчёты / Ещё (Клиенты в «Ещё»).
   */
  clubPtDock: boolean;
  /** Messages like pure GP (no client chat). */
  groupOnlyMessaging: boolean;
};

export function trainerCabinetMode(
  flags: TrainerCabinetFlags | null | undefined,
): TrainerCabinetMode {
  const isGp = Boolean(flags?.groupPrograms);
  const isReformer = Boolean(flags?.trainerReformers);
  const isStaffPt = Boolean(flags?.trainerStaff);
  const hasPt = Boolean(flags?.trainerStaff || flags?.trainerClub);
  const groupCabinet = isGp || isReformer;
  const isLegacy = !isGp && !isReformer && !hasPt;
  const showGp = groupCabinet || isLegacy;
  const showPt = hasPt || isLegacy;
  const showTimesheet = isStaffPt || isLegacy;
  // Journal is already available in API for trainerClub; UI used to hide it.
  const showPtControl = isStaffPt || isLegacy || Boolean(flags?.trainerClub);
  const showPayroll = isGp || isReformer || isStaffPt;
  const showOwnLedger = Boolean(flags?.trainerClub);
  const clubPtDock = showOwnLedger && showPt && !showGp && !isStaffPt;
  const groupOnlyMessaging = groupCabinet && !hasPt;

  return {
    groupCabinet,
    isGp,
    isReformer,
    hasPt,
    isLegacy,
    showGp,
    showPt,
    showTimesheet,
    showPtControl,
    showPayroll,
    showOwnLedger,
    clubPtDock,
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

/**
 * PT-only routes: pure GP / reformers are redirected away.
 * Journal and shifts stay available for group cabinets.
 */
export const TRAINER_PT_ONLY_PATHS = [
  '/trainer/schedule',
  '/trainer/clients',
  '/trainer/pt-timesheet',
] as const;

/** Staff-PT timesheet — hidden for «Тренер клуб» without trainerStaff. */
export const TRAINER_STAFF_TIMESHEET_PATHS = [
  '/trainer/pt-timesheet',
] as const;

export function isTrainerPtOnlyPath(pathname: string): boolean {
  return TRAINER_PT_ONLY_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function isTrainerStaffTimesheetPath(pathname: string): boolean {
  return TRAINER_STAFF_TIMESHEET_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}
