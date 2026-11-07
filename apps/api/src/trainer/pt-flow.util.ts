/** CLUB = admin control + payroll; PERSONAL = «Тренер клуб» ledger. */
export type PtBookingFlowValue = 'CLUB' | 'PERSONAL';

export function resolvePtFlow(
  trainer: {
    trainerClub?: boolean | null;
    trainerStaff?: boolean | null;
  },
  requested?: PtBookingFlowValue | null,
): PtBookingFlowValue {
  const club = Boolean(trainer.trainerClub);
  const staff = Boolean(trainer.trainerStaff);
  if (club && staff) {
    return requested === 'PERSONAL' ? 'PERSONAL' : 'CLUB';
  }
  if (club && !staff) return 'PERSONAL';
  return 'CLUB';
}

/** True when booking uses personal ledger (no admin control / no club payroll). */
export function isPersonalPtBooking(
  booking: { ptFlow?: PtBookingFlowValue | string | null },
  trainer: {
    trainerClub?: boolean | null;
    trainerStaff?: boolean | null;
  },
): boolean {
  if (booking.ptFlow === 'PERSONAL') return true;
  if (booking.ptFlow === 'CLUB') return false;
  return Boolean(trainer.trainerClub && !trainer.trainerStaff);
}

export function canChoosePtFlow(trainer: {
  trainerClub?: boolean | null;
  trainerStaff?: boolean | null;
}): boolean {
  return Boolean(trainer.trainerClub && trainer.trainerStaff);
}
