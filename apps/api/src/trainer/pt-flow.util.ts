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

/**
 * «Тренер клуб» may hard-delete a FitGO PT when:
 * - they created it themselves, or
 * - the client booked it but no-showed / cancelled / never arrived after end.
 */
export function canClubTrainerDeletePtBooking(input: {
  trainerId: string;
  trainerClub?: boolean | null;
  isComplimentary?: boolean | null;
  origin?: string | null;
  bookedByUserId?: string | null;
  status?: string | null;
  usageStatus?: string | null;
  endAt?: Date | string | null;
  arrivedCount?: number | null;
  noShowCount?: number | null;
  /** Linked live 1C sale / write-off — delete only after 1C cancel path. */
  linkedDocExternalId?: string | null;
}): boolean {
  if (!input.trainerClub) return false;
  if (input.isComplimentary) return false;
  if (input.linkedDocExternalId?.trim()) return false;

  const createdByTrainer =
    input.origin === 'TRAINER_ASSIGNED' ||
    (Boolean(input.bookedByUserId) &&
      input.bookedByUserId === input.trainerId);
  if (createdByTrainer) return true;

  const clientBooked =
    input.origin === 'CLIENT_BOOKED' ||
    (!input.origin &&
      Boolean(input.bookedByUserId) &&
      input.bookedByUserId !== input.trainerId);
  if (!clientBooked) return false;

  if (
    input.status === 'CANCELLED' ||
    input.usageStatus === 'NO_SHOW' ||
    input.usageStatus === 'CANCELLED'
  ) {
    return true;
  }

  const endMs = input.endAt
    ? new Date(input.endAt).getTime()
    : Number.NaN;
  if (!Number.isFinite(endMs) || endMs > Date.now()) return false;
  const arrived = input.arrivedCount ?? 0;
  const noShow = input.noShowCount ?? 0;
  return arrived === 0 && noShow > 0;
}
