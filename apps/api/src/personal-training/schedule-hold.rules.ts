/** Pure rules for HOLD_CLIENT auto-release / warn (unit-tested). */

import { AvailabilityBlockKind } from '@prisma/client';

export const HOLD_WARN_BEFORE_MS = 60 * 60 * 1000;

/** True when a client hold should be deleted by the cron. */
export function isHoldExpired(
  holdExpiresAt: Date | null | undefined,
  now = new Date(),
): boolean {
  if (!holdExpiresAt) return false;
  return holdExpiresAt.getTime() <= now.getTime();
}

/**
 * True when hold expires within warnBeforeMs and trainer was not warned yet.
 * Matches ScheduleHoldSchedulerService.warnExpiringHolds filter.
 */
export function isHoldInWarnWindow(input: {
  holdExpiresAt: Date | null | undefined;
  holdExpiryWarnedAt?: Date | null;
  now?: Date;
  warnBeforeMs?: number;
}): boolean {
  if (!input.holdExpiresAt) return false;
  if (input.holdExpiryWarnedAt) return false;
  const now = input.now ?? new Date();
  const warnMs = input.warnBeforeMs ?? HOLD_WARN_BEFORE_MS;
  const expires = input.holdExpiresAt.getTime();
  const t = now.getTime();
  return expires > t && expires <= t + warnMs;
}

/** Prisma-shaped where for deleteMany of expired holds. */
export function expiredHoldWhere(now = new Date()) {
  return {
    kind: AvailabilityBlockKind.HOLD_CLIENT,
    holdExpiresAt: { lte: now },
  };
}
