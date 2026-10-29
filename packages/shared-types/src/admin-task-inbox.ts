/**
 * Admin task inbox — shared taxonomy for admin queue, home focus, manager board.
 * Pure helpers (no Nest/Prisma) so web + API stay in sync on bucket/owner/counts.
 */

import type { GroupApprovalPendingTask } from './booking-control';

/** Filter category on the admin inbox chips. */
export type AdminInboxKind =
  | 'calls'
  | 'money'
  | 'control'
  | 'manager'
  | 'staff';

/** Urgency lane for sorting / segment filters. */
export type AdminInboxBucket =
  | 'overdue'
  | 'today'
  | 'upcoming'
  | 'waiting'
  | 'done';

/** Who owns the row relative to the current admin. */
export type AdminInboxOwner = 'mine' | 'pool' | 'other';

export type AdminInboxPrimaryAction =
  | 'call'
  | 'open_renewal'
  | 'open_session'
  | 'confirm'
  | 'complete';

/** Segment tabs on /admin/tasks. */
export type AdminInboxView =
  | 'now'
  | 'mine'
  | 'pool'
  | 'waiting'
  | 'done';

/** Outcome action effect applied via existing claim/snooze/PATCH APIs (phase 1). */
export type AdminTaskOutcomeEffect =
  | 'done'
  | 'snooze'
  | 'cancel'
  | 'block'
  | 'open_renewal'
  | 'open_session';

export interface AdminTaskOutcomeDef {
  id: string;
  label: string;
  effect: AdminTaskOutcomeEffect;
  /** Days to push nextActionAt / dueAt when effect = snooze. */
  snoozeDays?: number;
  /** Require a free-text comment. */
  needsComment?: boolean;
  /** Require a date picker (promise / reschedule). */
  needsDate?: boolean;
}

export type AdminInboxTopic =
  | 'staff_debt'
  | 'client_debt'
  | 'membership'
  | 'installment'
  | 'manager'
  | 'birthday'
  | 'confirmation'
  | 'pt_sale_check'
  | 'group_approval'
  | 'spa_approval'
  | 'pt_approval'
  | 'other';

export interface AdminInboxCounts {
  overdue: number;
  today: number;
  mine: number;
  pool: number;
  waiting: number;
  doneToday: number;
  rework: number;
  byKind: Record<AdminInboxKind, number>;
  /** Legacy topic counters (home pins / dashboard compatibility). */
  byTopic: {
    membership: number;
    birthday: number;
    client_debt: number;
    staff_debt: number;
    installment: number;
    manager: number;
    confirmation: number;
    pt_sale_check: number;
    group_approval: number;
    spa_approval: number;
    pt_approval: number;
  };
  total: number;
}

/** Minimal task shape accepted by inbox helpers (avoids circular import with index). */
export interface AdminInboxTaskLike {
  id: string;
  title: string;
  description?: string;
  status: string;
  dueAt?: string;
  completedAt?: string;
  source?: string;
  topic?: string;
  assignee?: { id: string; firstName: string; lastName: string };
  nextActionAt?: string;
  phone?: string;
  membershipName?: string;
  validUntil?: string;
  daysLeft?: number;
  debtTotal?: number;
  debtCount?: number;
  debtAgeDays?: number;
  templateName?: string;
  saleNumber?: string;
  planAmount?: number;
  overdueDays?: number;
  roomTitle?: string;
  confirmClients?: Array<{ confirmed: boolean }>;
  reworkCount?: number;
  reworkComment?: string;
  /** Booking-control card deep link (MANAGER rework from control). */
  sessionKey?: string | null;
  clientExternalId?: string | null;
}

/** Unified inbox row — real AdminTask or virtual booking-control approval. */
export interface AdminInboxItem {
  id: string;
  /** True when id is a sessionKey and there is no AdminTask row. */
  virtual: boolean;
  kind: AdminInboxKind;
  bucket: AdminInboxBucket;
  owner: AdminInboxOwner;
  primaryAction: AdminInboxPrimaryAction;
  title: string;
  subtitle?: string;
  phone?: string;
  dueAt?: string;
  nextActionAt?: string;
  status?: string;
  source?: string;
  /** Legacy topic for URL compatibility. */
  topic?: AdminInboxTopic;
  assignee?: { id: string; firstName: string; lastName: string };
  reworkCount?: number;
  reworkComment?: string;
  /**
   * Client has a non-cancelled GP / PT / SPA booking today.
   * Set by API for money tasks so reception can settle debt on visit.
   */
  visitToday?: boolean;
  outcomes: AdminTaskOutcomeDef[];
  /** Present for real tasks — full payload for detail panels. */
  task?: AdminInboxTaskLike;
  /** Present for virtual control rows. */
  pending?: GroupApprovalPendingTask;
}

export const ADMIN_INBOX_KIND_LABEL: Record<AdminInboxKind, string> = {
  calls: 'Звонки',
  money: 'Деньги',
  control: 'Контроль',
  manager: 'Руководитель',
  staff: 'Персонал',
};

export const ADMIN_INBOX_VIEW_LABEL: Record<AdminInboxView, string> = {
  now: 'Сейчас',
  mine: 'Мои',
  pool: 'Общие',
  waiting: 'Ждут',
  done: 'Сделано',
};

const EMPTY_BY_KIND = (): Record<AdminInboxKind, number> => ({
  calls: 0,
  money: 0,
  control: 0,
  manager: 0,
  staff: 0,
});

const EMPTY_BY_TOPIC = (): AdminInboxCounts['byTopic'] => ({
  membership: 0,
  birthday: 0,
  client_debt: 0,
  staff_debt: 0,
  installment: 0,
  manager: 0,
  confirmation: 0,
  pt_sale_check: 0,
  group_approval: 0,
  spa_approval: 0,
  pt_approval: 0,
});

function startOfLocalDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfLocalDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Map task source/topic → inbox kind. */
export function adminInboxKindFromTask(task: {
  source?: string | null;
  topic?: string | null;
}): AdminInboxKind {
  const source = task.source ?? '';
  const topic = task.topic ?? '';
  if (
    source === 'MEMBERSHIP_EXPIRING' ||
    source === 'BIRTHDAY' ||
    topic === 'membership' ||
    topic === 'birthday'
  ) {
    return 'calls';
  }
  if (
    source === 'CLIENT_DEBT' ||
    source === 'DEBT_OVERDUE' ||
    source === 'INSTALLMENT_PAYMENT' ||
    topic === 'client_debt' ||
    topic === 'installment'
  ) {
    return 'money';
  }
  if (source === 'STAFF_DEBT' || topic === 'staff_debt') return 'staff';
  if (
    source === 'MANAGER' ||
    source === 'DISCREPANCY' ||
    topic === 'manager'
  ) {
    return 'manager';
  }
  if (
    source === 'BOOKING_CONFIRM' ||
    source === 'TRAINING_SALE_NO_PERFORMER' ||
    topic === 'confirmation' ||
    topic === 'pt_sale_check' ||
    topic === 'group_approval' ||
    topic === 'spa_approval' ||
    topic === 'pt_approval'
  ) {
    return 'control';
  }
  return 'control';
}

export function adminInboxOwner(
  assigneeId: string | null | undefined,
  currentUserId: string,
): AdminInboxOwner {
  if (!assigneeId) return 'pool';
  if (assigneeId === currentUserId) return 'mine';
  return 'other';
}

/**
 * Urgency bucket. Waiting = IN_PROGRESS with nextActionAt in the future.
 * Done = DONE / CANCELLED. Overdue = ref time before start of today.
 */
export function adminInboxBucket(
  input: {
    status?: string | null;
    dueAt?: string | Date | null;
    nextActionAt?: string | Date | null;
  },
  now = new Date(),
): AdminInboxBucket {
  const status = input.status ?? '';
  if (status === 'DONE' || status === 'CANCELLED') {
    return 'done';
  }
  const next =
    input.nextActionAt != null ? new Date(input.nextActionAt).getTime() : null;
  if (
    status === 'IN_PROGRESS' &&
    next != null &&
    !Number.isNaN(next) &&
    next > now.getTime()
  ) {
    return 'waiting';
  }
  const refRaw = input.nextActionAt ?? input.dueAt;
  if (refRaw == null) return 'today';
  const ref = new Date(refRaw).getTime();
  if (Number.isNaN(ref)) return 'today';
  const dayStart = startOfLocalDay(now).getTime();
  const dayEnd = endOfLocalDay(now).getTime();
  if (ref < dayStart) return 'overdue';
  if (ref <= dayEnd) return 'today';
  return 'upcoming';
}

export function outcomesForSource(source?: string | null): AdminTaskOutcomeDef[] {
  switch (source) {
    case 'CLIENT_DEBT':
    case 'DEBT_OVERDUE':
    case 'STAFF_DEBT':
      return [
        { id: 'paid', label: 'Оплатил', effect: 'done' },
        {
          id: 'promised',
          label: 'Обещал оплатить',
          effect: 'snooze',
          needsDate: true,
          snoozeDays: 3,
        },
        {
          id: 'no_answer',
          label: 'Не дозвонился',
          effect: 'snooze',
          snoozeDays: 1,
        },
        {
          id: 'refuse',
          label: 'Отказ',
          effect: 'block',
          needsComment: true,
        },
      ];
    case 'INSTALLMENT_PAYMENT':
      return [
        { id: 'paid', label: 'Внёс платёж', effect: 'done' },
        {
          id: 'reschedule',
          label: 'Перенос',
          effect: 'snooze',
          needsDate: true,
          snoozeDays: 2,
        },
        {
          id: 'no_answer',
          label: 'Не дозвонился',
          effect: 'snooze',
          snoozeDays: 1,
        },
      ];
    case 'BIRTHDAY':
      return [
        { id: 'congratulated', label: 'Поздравил', effect: 'done' },
        {
          id: 'no_answer',
          label: 'Не дозвонился',
          effect: 'snooze',
          snoozeDays: 1,
        },
        {
          id: 'do_not_call',
          label: 'Не звонить',
          effect: 'cancel',
          needsComment: true,
        },
      ];
    case 'MANAGER':
    case 'DISCREPANCY':
      return [
        {
          id: 'done',
          label: 'Выполнено',
          effect: 'done',
          needsComment: source === 'DISCREPANCY',
        },
        {
          id: 'block',
          label: 'Не могу',
          effect: 'block',
          needsComment: true,
        },
      ];
    case 'TRAINING_SALE_NO_PERFORMER':
      return [
        { id: 'done', label: 'Готово', effect: 'done' },
        {
          id: 'block',
          label: 'Не могу',
          effect: 'block',
          needsComment: true,
        },
      ];
    case 'MEMBERSHIP_EXPIRING':
      return [{ id: 'open', label: 'Открыть воронку', effect: 'open_renewal' }];
    case 'BOOKING_CONFIRM':
      return [{ id: 'confirm', label: 'Подтвердить', effect: 'done' }];
    default:
      return [{ id: 'done', label: 'Готово', effect: 'done' }];
  }
}

export function primaryActionForTask(task: {
  source?: string | null;
  phone?: string | null;
  sessionKey?: string | null;
}): AdminInboxPrimaryAction {
  const source = task.source ?? '';
  if (source === 'MEMBERSHIP_EXPIRING') return 'open_renewal';
  if (source === 'BOOKING_CONFIRM') return 'confirm';
  if (source === 'MANAGER' && task.sessionKey) return 'open_session';
  if (
    source === 'MANAGER' ||
    source === 'DISCREPANCY' ||
    source === 'TRAINING_SALE_NO_PERFORMER'
  ) {
    return 'complete';
  }
  // Debts / installments: settle on visit — call is optional, not primary CTA.
  if (
    source === 'CLIENT_DEBT' ||
    source === 'DEBT_OVERDUE' ||
    source === 'INSTALLMENT_PAYMENT' ||
    source === 'STAFF_DEBT'
  ) {
    return 'complete';
  }
  if (task.phone) return 'call';
  return 'complete';
}

/** Focus queue lane (lower = higher priority). null = not in «Мой фокус» / view=now. */
export function adminFocusLane(item: AdminInboxItem): number | null {
  if (item.owner === 'other') return null;
  if (item.bucket === 'done' || item.bucket === 'waiting') return null;

  const rework = (item.reworkCount ?? 0) > 0;
  const dueNow =
    item.bucket === 'overdue' || item.bucket === 'today' || rework;

  if (item.kind === 'manager') return 0;

  if (
    item.source === 'BOOKING_CONFIRM' ||
    item.topic === 'confirmation'
  ) {
    return 1;
  }

  if (
    item.topic === 'membership' ||
    item.topic === 'birthday' ||
    item.source === 'MEMBERSHIP_EXPIRING' ||
    item.source === 'BIRTHDAY'
  ) {
    return dueNow ? 2 : null;
  }

  if (
    item.kind === 'money' ||
    item.topic === 'client_debt' ||
    item.topic === 'installment' ||
    item.source === 'CLIENT_DEBT' ||
    item.source === 'DEBT_OVERDUE' ||
    item.source === 'INSTALLMENT_PAYMENT'
  ) {
    if (item.visitToday && dueNow) return 3;
    return null;
  }

  if (item.kind === 'control') {
    return dueNow ? 4 : null;
  }

  return null;
}

export function isInAdminFocusQueue(item: AdminInboxItem): boolean {
  return adminFocusLane(item) != null;
}

function outcomesForManagerTask(task: {
  source?: string | null;
  sessionKey?: string | null;
}): AdminTaskOutcomeDef[] {
  const base = outcomesForSource(task.source);
  if (task.source === 'MANAGER' && task.sessionKey) {
    return [
      { id: 'open', label: 'Открыть карточку', effect: 'open_session' },
      ...base,
    ];
  }
  return base;
}

function displayTitle(task: AdminInboxTaskLike): string {
  const t = task.title ?? '';
  return (
    t
      .replace(/^Абонемент истекает:\s*/i, '')
      .replace(/^День рождения:\s*/i, '')
      .replace(/^Долг (клиента|сотрудника):\s*/i, '')
      .replace(/^Рассрочка:\s*/i, '')
      .replace(/^Подтверждение:\s*/i, '')
      .replace(/\s*\([\d\s.,]+\s*BYN\)\s*$/i, '')
      .trim() || t
  );
}

function subtitleForTask(
  task: AdminInboxTaskLike,
  opts?: { visitToday?: boolean },
): string | undefined {
  const source = task.source ?? '';
  const visitHint =
    opts?.visitToday &&
    (source === 'CLIENT_DEBT' ||
      source === 'DEBT_OVERDUE' ||
      source === 'INSTALLMENT_PAYMENT' ||
      source === 'STAFF_DEBT')
      ? 'На визите, звонок не обязателен'
      : null;
  if (source === 'MEMBERSHIP_EXPIRING') {
    const parts = [
      task.membershipName ?? 'Абонемент',
      task.validUntil ? `до ${task.validUntil.slice(0, 10)}` : null,
      task.daysLeft != null ? `${task.daysLeft} дн.` : null,
    ].filter(Boolean);
    return parts.join(' · ') || undefined;
  }
  if (
    source === 'CLIENT_DEBT' ||
    source === 'STAFF_DEBT' ||
    source === 'DEBT_OVERDUE'
  ) {
    const parts = [
      task.debtTotal != null ? `${task.debtTotal.toFixed(2)} BYN` : null,
      task.debtCount != null ? `${task.debtCount} продаж` : null,
      task.debtAgeDays != null ? `${task.debtAgeDays} дн.` : null,
      visitHint,
    ].filter(Boolean);
    return parts.join(' · ') || undefined;
  }
  if (source === 'INSTALLMENT_PAYMENT') {
    const parts = [
      task.templateName ?? 'Рассрочка',
      task.saleNumber ? `№${task.saleNumber}` : null,
      task.planAmount != null ? `${task.planAmount.toFixed(2)} BYN` : null,
      task.overdueDays != null && task.overdueDays > 0
        ? `просрочка ${task.overdueDays} дн.`
        : null,
      visitHint,
    ].filter(Boolean);
    return parts.join(' · ') || undefined;
  }
  if (source === 'BIRTHDAY') return 'Поздравить сегодня';
  if (source === 'BOOKING_CONFIRM') {
    const parts = [
      task.membershipName ?? 'Запись',
      task.roomTitle,
      task.confirmClients
        ? `${task.confirmClients.filter((c) => c.confirmed).length}/${task.confirmClients.length}`
        : null,
    ].filter(Boolean);
    return parts.join(' · ') || undefined;
  }
  if (task.description) {
    const line = task.description.split('\n')[0]?.trim();
    return line || undefined;
  }
  return undefined;
}

/** Build inbox item from a real task payload. */
export function adminInboxItemFromTask(
  task: AdminInboxTaskLike,
  currentUserId: string,
  now = new Date(),
  opts?: { visitToday?: boolean },
): AdminInboxItem {
  const kind = adminInboxKindFromTask(task);
  const bucket = adminInboxBucket(task, now);
  const owner = adminInboxOwner(task.assignee?.id, currentUserId);
  const visitToday = opts?.visitToday === true;
  return {
    id: task.id,
    virtual: false,
    kind,
    bucket,
    owner,
    primaryAction: primaryActionForTask(task),
    title: displayTitle(task),
    subtitle: subtitleForTask(task, { visitToday }),
    phone: task.phone,
    dueAt: task.dueAt,
    nextActionAt: task.nextActionAt,
    status: task.status,
    source: task.source,
    topic: (task.topic as AdminInboxTopic | undefined) ?? undefined,
    assignee: task.assignee,
    reworkCount: task.reworkCount,
    reworkComment: task.reworkComment,
    visitToday: visitToday || undefined,
    outcomes: outcomesForManagerTask(task),
    task,
  };
}

/** Build virtual inbox item from booking-control pending approval. */
export function adminInboxItemFromPending(
  pending: GroupApprovalPendingTask,
  now = new Date(),
): AdminInboxItem {
  const kindCode = pending.kind ?? 'GROUP';
  const topic: AdminInboxTopic =
    kindCode === 'SPA'
      ? 'spa_approval'
      : kindCode === 'PT'
        ? 'pt_approval'
        : 'group_approval';
  const bucket = adminInboxBucket(
    { status: 'OPEN', dueAt: pending.startAt },
    now,
  );
  const reason =
    pending.reason === 'UNPAID'
      ? 'Не оплачена'
      : `${kindCode === 'GROUP' ? 'ГП' : kindCode} ждёт подтверждения`;
  const parts = [
    reason,
    pending.performerName,
    pending.clientName,
    kindCode === 'GROUP'
      ? `тренер ${pending.trainerSeenCount} · 1С ${pending.arrivedCount} · зап. ${pending.bookedCount}`
      : null,
  ].filter(Boolean);
  return {
    id: `virtual:${pending.sessionKey}`,
    virtual: true,
    kind: 'control',
    bucket,
    owner: 'pool',
    primaryAction: 'open_session',
    title: pending.title,
    subtitle: parts.join(' · '),
    dueAt: pending.startAt,
    status: 'OPEN',
    source: `BOOKING_${kindCode}`,
    topic,
    outcomes: [
      { id: 'open', label: 'Открыть карточку', effect: 'open_session' },
    ],
    pending,
  };
}

/** Sort: rework → overdue (oldest) → today → rest. */
export function sortAdminInboxItems(items: AdminInboxItem[]): AdminInboxItem[] {
  const rank = (b: AdminInboxBucket) => {
    switch (b) {
      case 'overdue':
        return 0;
      case 'today':
        return 1;
      case 'upcoming':
        return 2;
      case 'waiting':
        return 3;
      case 'done':
        return 4;
      default:
        return 5;
    }
  };
  return [...items].sort((a, b) => {
    const ar = (a.reworkCount ?? 0) > 0 && a.bucket !== 'done' ? 0 : 1;
    const br = (b.reworkCount ?? 0) > 0 && b.bucket !== 'done' ? 0 : 1;
    if (ar !== br) return ar - br;
    const rb = rank(a.bucket) - rank(b.bucket);
    if (rb !== 0) return rb;
    const at = new Date(a.nextActionAt ?? a.dueAt ?? 0).getTime();
    const bt = new Date(b.nextActionAt ?? b.dueAt ?? 0).getTime();
    return at - bt;
  });
}

/** Sort for «Мой фокус» / view=now without kind filter. */
export function sortAdminFocusItems(items: AdminInboxItem[]): AdminInboxItem[] {
  return [...items].sort((a, b) => {
    const la = adminFocusLane(a) ?? 99;
    const lb = adminFocusLane(b) ?? 99;
    if (la !== lb) return la - lb;
    const at = new Date(a.nextActionAt ?? a.dueAt ?? 0).getTime();
    const bt = new Date(b.nextActionAt ?? b.dueAt ?? 0).getTime();
    return at - bt;
  });
}

export function filterAdminInboxItems(
  items: AdminInboxItem[],
  opts: { view?: AdminInboxView; kind?: AdminInboxKind | null },
): AdminInboxItem[] {
  const view = opts.view ?? 'now';
  const kind = opts.kind ?? null;
  const filtered = items.filter((item) => {
    if (kind && item.kind !== kind) return false;
    switch (view) {
      case 'now':
        // Default focus queue: manager → confirm → renewals → visit money → control.
        // Explicit kind keeps legacy overdue/today urgency filter.
        if (!kind) return isInAdminFocusQueue(item);
        // Manager tasks stay in focus regardless of due bucket (except waiting/done).
        if (
          kind === 'manager' &&
          item.kind === 'manager' &&
          item.owner !== 'other' &&
          item.bucket !== 'done' &&
          item.bucket !== 'waiting'
        ) {
          return true;
        }
        // SPA / reformer confirms are due tomorrow (bucket upcoming) but still actionable.
        if (
          kind === 'control' &&
          (item.topic === 'confirmation' ||
            item.source === 'BOOKING_CONFIRM') &&
          item.owner !== 'other' &&
          item.bucket !== 'done' &&
          item.bucket !== 'waiting'
        ) {
          return true;
        }
        return (
          (item.bucket === 'overdue' ||
            item.bucket === 'today' ||
            ((item.reworkCount ?? 0) > 0 && item.bucket !== 'done')) &&
          item.owner !== 'other'
        );
      case 'mine':
        return item.owner === 'mine' && item.bucket !== 'done';
      case 'pool':
        return item.owner === 'pool' && item.bucket !== 'done';
      case 'waiting':
        return item.bucket === 'waiting';
      case 'done':
        return item.bucket === 'done';
      default:
        return true;
    }
  });
  if (view === 'now' && !kind) {
    return sortAdminFocusItems(filtered);
  }
  return filtered;
}

export function inboxCountsFromItems(
  items: AdminInboxItem[],
  now = new Date(),
): AdminInboxCounts {
  const dayStart = startOfLocalDay(now).getTime();
  const counts: AdminInboxCounts = {
    overdue: 0,
    today: 0,
    mine: 0,
    pool: 0,
    waiting: 0,
    doneToday: 0,
    rework: 0,
    byKind: EMPTY_BY_KIND(),
    byTopic: EMPTY_BY_TOPIC(),
    total: 0,
  };

  for (const item of items) {
    if (item.bucket === 'done') {
      const completed = item.task?.completedAt
        ? new Date(item.task.completedAt).getTime()
        : null;
      if (completed != null && completed >= dayStart) {
        counts.doneToday += 1;
      }
      continue;
    }

    counts.byKind[item.kind] += 1;
    if (item.bucket === 'waiting') counts.waiting += 1;
    if (item.owner === 'mine') counts.mine += 1;
    if (item.owner === 'pool') counts.pool += 1;

    const topic = item.topic;
    if (topic && topic in counts.byTopic) {
      counts.byTopic[topic as keyof AdminInboxCounts['byTopic']] += 1;
    }

    // Focus counters (Мой фокус / Просрочено / Сегодня) — actionable queue only.
    if (!isInAdminFocusQueue(item)) continue;

    counts.total += 1;
    if (item.bucket === 'overdue') counts.overdue += 1;
    if (item.bucket === 'today') counts.today += 1;
    if ((item.reworkCount ?? 0) > 0) counts.rework += 1;
  }

  return counts;
}

/** Map legacy ?topic= / ?group= URL params → view + kind. */
export function parseLegacyAdminTasksQuery(params: {
  topic?: string | null;
  group?: string | null;
  view?: string | null;
  kind?: string | null;
}): { view: AdminInboxView; kind: AdminInboxKind | null } {
  const viewRaw = params.view;
  const view: AdminInboxView =
    viewRaw === 'mine' ||
    viewRaw === 'pool' ||
    viewRaw === 'waiting' ||
    viewRaw === 'done' ||
    viewRaw === 'now'
      ? viewRaw
      : 'now';

  const kindRaw = params.kind;
  if (
    kindRaw === 'calls' ||
    kindRaw === 'money' ||
    kindRaw === 'control' ||
    kindRaw === 'manager' ||
    kindRaw === 'staff'
  ) {
    return { view, kind: kindRaw };
  }

  const topic = params.topic;
  if (topic === 'membership' || topic === 'birthday') {
    return { view, kind: 'calls' };
  }
  if (topic === 'client_debt' || topic === 'installment') {
    return { view, kind: 'money' };
  }
  if (topic === 'staff_debt') return { view, kind: 'staff' };
  if (
    topic === 'group_approval' ||
    topic === 'spa_approval' ||
    topic === 'pt_approval' ||
    topic === 'confirmation' ||
    topic === 'pt_sale_check'
  ) {
    return { view, kind: 'control' };
  }

  const group = params.group;
  if (group === 'clients') return { view, kind: 'calls' };
  if (group === 'staff') return { view, kind: 'staff' };
  if (group === 'manager') return { view, kind: 'manager' };
  if (group === 'control') return { view, kind: 'control' };

  return { view, kind: null };
}

export interface AdminTasksInboxResponse {
  items: AdminInboxItem[];
  counts: AdminInboxCounts;
  /** ISO time of last background sync kick (debts / confirmations). */
  refreshedAt?: string;
  skippedBirthdays?: number;
  birthdayScanError?: string | null;
}
