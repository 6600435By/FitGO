import type { ScheduleSlot } from '@fitgo/shared-types';
import type { OnexClassSession, OnexClassStatus } from '@prisma/client';
import type { ClubScheduleStatus } from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 86400000;
const RANGE_DAYS = 31;

export function isFormaEmployeeId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id,
  );
}

export function localDayKey(d = new Date()): string {
  return d.toLocaleDateString('fr-CA');
}

export function clampScheduleRange(from?: string, to?: string): {
  fromDay: string;
  toDay: string;
  rangeStart: Date;
  rangeEnd: Date;
} {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minDay = new Date(today.getTime() - RANGE_DAYS * DAY_MS);
  const maxDay = new Date(today.getTime() + RANGE_DAYS * DAY_MS);

  let fromD = from?.trim()
    ? new Date(`${from.trim().slice(0, 10)}T00:00:00`)
    : new Date(today);
  let toD = to?.trim()
    ? new Date(`${to.trim().slice(0, 10)}T23:59:59.999`)
    : new Date(maxDay.getTime() + DAY_MS - 1);

  if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
    fromD = new Date(today);
    toD = new Date(maxDay.getTime() + DAY_MS - 1);
  }

  if (fromD < minDay) fromD = new Date(minDay);
  if (toD > new Date(maxDay.getTime() + DAY_MS - 1)) {
    toD = new Date(maxDay.getTime() + DAY_MS - 1);
  }
  if (fromD > toD) fromD = new Date(toD);

  return {
    fromDay: localDayKey(fromD),
    toDay: localDayKey(toD),
    rangeStart: fromD,
    rangeEnd: toD,
  };
}

export function formaScheduleRange(fromDay: string, toDay: string): {
  from: string;
  to: string;
} {
  return {
    from: `${fromDay} 00:00`,
    to: `${toDay} 23:59`,
  };
}

export async function filterTrainerScheduleSlots(
  prisma: PrismaService,
  slots: ScheduleSlot[],
  user: JwtPayload,
): Promise<ScheduleSlot[]> {
  const externalId = user.externalId ?? '1c-trainer-001';

  if (isFormaEmployeeId(externalId)) {
    return slots.filter((slot) => slot.trainerId === externalId);
  }

  const dbTrainer = await prisma.user.findUnique({
    where: { id: user.sub },
  });
  if (!dbTrainer) return slots;

  const first = dbTrainer.firstName.trim();
  const last = dbTrainer.lastName.trim();
  return slots.filter((slot) => {
    if (slot.trainerId === externalId) return true;
    const name = slot.trainerName?.toLowerCase() ?? '';
    return (
      (first && name.includes(first.toLowerCase())) ||
      (last && name.includes(last.toLowerCase()))
    );
  });
}

export function mapOnexToClubStatus(
  status: OnexClassStatus | string | undefined,
  endAt?: Date | string | null,
): ClubScheduleStatus {
  const s = String(status ?? '').toUpperCase();
  if (s === 'CANCELLED') return 'cancelled';
  if (s === 'COMPLETED') return 'done';
  if (s === 'SCHEDULED' || s === 'IN_PROGRESS') {
    const end = endAt ? new Date(endAt) : null;
    if (end && end.getTime() < Date.now()) return 'done';
    return 'planned';
  }
  const end = endAt ? new Date(endAt) : null;
  if (end && end.getTime() < Date.now()) return 'done';
  return 'planned';
}

export function inferSlotStatus(
  slot: ScheduleSlot,
  onex?: Pick<OnexClassSession, 'status' | 'endAt'> | null,
): ClubScheduleStatus {
  if (onex) return mapOnexToClubStatus(onex.status, onex.endAt ?? slot.endAt);
  if (!slot.available && slot.booked === 0 && slot.capacity > 0) {
    return 'cancelled';
  }
  return mapOnexToClubStatus(undefined, slot.endAt);
}
