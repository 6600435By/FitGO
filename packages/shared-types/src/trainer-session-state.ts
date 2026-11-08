/**
 * Trainer session clock vs result — shared rules for Today, schedule, card,
 * client history and journal. Wall-clock alone never confirms attendance,
 * payment write-off, or payroll.
 *
 * Counter scopes (do not equate the numbers):
 * - pendingMe («Закрыть сейчас» on Today): only this trainer’s confirm mark
 *   after the slot end (lookback ~45 days). Excludes unpaid and admin-wait.
 * - journalPending («На контроле»): period queue — unpaid / remarks / not in
 *   1C or journal, or approval-wait after the slot is due (incl. admin).
 */

export const CLUB_TZ = 'Europe/Minsk';

/** Fixed UTC+3 — Belarus has no DST. */
export const CLUB_UTC_OFFSET = '+03:00';

export const TRAINER_CONTROL_PENDING_LOOKBACK_DAYS = 45;

export const TRAINER_CONTROL_SCOPES = {
  pendingMe: {
    key: 'pendingMe' as const,
    titleRu: 'Закрыть сейчас',
    emptyRu: 'Нет слотов на вашу отметку',
    /** Shown under the Today counter — different from journal «На контроле». */
    scopeRu:
      'Только ваша отметка после окончания слота (до 45 дней). Оплата и очередь администратора — в журнале.',
  },
  journalPending: {
    key: 'journalPending' as const,
    titleRu: 'На контроле',
    scopeRu:
      'За период: нет оплаты, замечания, нет в 1С/журнале или ожидание подтверждения после окончания слота (включая администратора).',
  },
} as const;

export type SessionClockPhase =
  | 'UPCOMING'
  | 'IN_PROGRESS'
  | 'ELAPSED'
  | 'CANCELLED';

/** Who still owes a confirm mark — independent of the clock. */
export type SessionResultPending =
  | 'none'
  | 'trainer'
  | 'admin'
  | 'approved';

export function clubDateParts(now: Date = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLUB_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** Club calendar day YYYY-MM-DD (Europe/Minsk). */
export function clubDayKey(now: Date = new Date()): string {
  const { year, month, day } = clubDateParts(now);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Inclusive Minsk day bounds for a YYYY-MM-DD club day. */
export function clubDayBounds(dayKey: string): { start: Date; end: Date } {
  return {
    start: new Date(`${dayKey}T00:00:00${CLUB_UTC_OFFSET}`),
    end: new Date(`${dayKey}T23:59:59.999${CLUB_UTC_OFFSET}`),
  };
}

function asMs(value: string | Date): number {
  return typeof value === 'string' ? Date.parse(value) : value.getTime();
}

/** Slot end used for «time due» (approval / elapsed). Missing end → start. */
export function sessionSlotEndMs(input: {
  startAt: string | Date;
  endAt?: string | Date | null;
}): number {
  if (input.endAt != null && input.endAt !== '') {
    const end = asMs(input.endAt);
    if (!Number.isNaN(end)) return end;
  }
  return asMs(input.startAt);
}

/**
 * Wall-clock phase only. Never use this to set attendance, payment, or payroll.
 */
export function sessionClockPhase(input: {
  startAt: string | Date;
  endAt?: string | Date | null;
  cancelled?: boolean;
  nowMs?: number;
}): SessionClockPhase {
  if (input.cancelled) return 'CANCELLED';
  const now = input.nowMs ?? Date.now();
  const start = asMs(input.startAt);
  const end = sessionSlotEndMs(input);
  if (now < start) return 'UPCOMING';
  if (now <= end) return 'IN_PROGRESS';
  return 'ELAPSED';
}

export function sessionResultPendingFromPhase(
  phase: string | null | undefined,
): SessionResultPending {
  if (!phase) return 'none';
  if (phase === 'APPROVED') return 'approved';
  if (phase === 'PENDING_ADMIN') return 'admin';
  if (
    phase === 'PENDING_TRAINER' ||
    phase === 'PENDING_PERFORMER'
  ) {
    return 'trainer';
  }
  return 'none';
}

/**
 * Approval wait becomes due only after the slot end — same moment the journal
 * attaches «Ждёт тренера» / «Ждёт администратора» for SCHEDULED rows.
 */
export function sessionApprovalDue(input: {
  startAt: string | Date;
  endAt?: string | Date | null;
  nowMs?: number;
}): boolean {
  const now = input.nowMs ?? Date.now();
  return sessionSlotEndMs(input) <= now;
}

/** Trainer still owes their own confirm (Today «Закрыть сейчас» / journal chip). */
export function trainerOwnConfirmPending(input: {
  approvalPhase?: string | null;
  startAt: string | Date;
  endAt?: string | Date | null;
  cancelled?: boolean;
  nowMs?: number;
}): boolean {
  if (input.cancelled) return false;
  if (!sessionApprovalDue(input)) return false;
  const result = sessionResultPendingFromPhase(input.approvalPhase);
  // No phase row yet after end → still waiting for performer (FitGO PT/SPA).
  if (input.approvalPhase == null) return true;
  return result === 'trainer';
}

/**
 * One explain line for Today / schedule / card / history / journal.
 * Clock and result are composed; elapsed + unconfirmed never reads as «Сейчас».
 */
export function sessionStateExplainRu(input: {
  clock: SessionClockPhase;
  result?: SessionResultPending;
  /** When result is omitted but confirm is still owed after elapsed. */
  needsConfirm?: boolean;
}): string {
  const result =
    input.result ??
    (input.needsConfirm ? ('trainer' as const) : ('none' as const));

  if (input.clock === 'CANCELLED') return 'Отменена';
  if (input.clock === 'UPCOMING') return 'Ещё не началась';
  if (input.clock === 'IN_PROGRESS') {
    return result === 'trainer' ? 'Идёт · отметка после окончания' : 'Идёт';
  }
  // ELAPSED
  if (result === 'trainer') {
    return 'Время прошло, результат не подтверждён';
  }
  if (result === 'admin') {
    return 'Время прошло · ждёт администратора';
  }
  if (result === 'approved') return 'Результат подтверждён';
  return 'Время прошло';
}

/** Short label while counting down to start — not a conduct confirmation. */
export const SESSION_CLOCK_NOW_IS_NOT_CONFIRM =
  'Время слота не подтверждает посещение, оплату и зарплату';
