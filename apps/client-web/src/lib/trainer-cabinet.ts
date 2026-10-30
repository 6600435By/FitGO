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
  /** Payroll menu entry. */
  showPayroll: boolean;
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
    groupOnlyMessaging,
  };
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
