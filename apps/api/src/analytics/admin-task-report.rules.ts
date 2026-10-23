import type { AdminTaskWorkTopic } from '@fitgo/shared-types';

export const RATING_MIN_CLOSED = 5;
export const RATING_ON_TIME_WEIGHT = 0.5;
export const RATING_VOLUME_WEIGHT = 0.35;
export const RATING_REWORK_WEIGHT = 0.15;

export const RATING_FORMULA =
  'Рейтинг = 50% × % в срок + 35% × объём относительно медианы команды + 15% × (100 − % доработок). Место — от 5 закрытых за период. Автозакрытие системой не считается.';

export const TOPIC_LABELS: Record<AdminTaskWorkTopic, string> = {
  staff_debt: 'Долг сотрудника',
  client_debt: 'Долг клиента',
  membership: 'Абонемент',
  installment: 'Рассрочка',
  manager: 'От руководителя',
  birthday: 'День рождения',
  confirmation: 'Подтверждение записи',
  pt_sale_check: 'Проверка продажи ПТ',
  other: 'Прочее',
};

export const TOPIC_ORDER: AdminTaskWorkTopic[] = [
  'staff_debt',
  'client_debt',
  'membership',
  'installment',
  'manager',
  'birthday',
  'confirmation',
  'pt_sale_check',
  'other',
];

export type TaskCompletionMode = 'SHARED' | 'INDIVIDUAL';

export interface CreditTaskInput {
  id: string;
  groupId: string | null;
  completionMode: TaskCompletionMode;
  assigneeId: string | null;
  status: string;
  completedAt: Date | null;
  /** Actor who closed this task (from AdminTaskEvent on DONE). */
  closerActorId: string | null;
}

export interface CreditGroup {
  /** Representative task id (primary closer's task). */
  taskId: string;
  /** Who gets credit for closing. */
  creditUserId: string | null;
  memberIds: string[];
}

/**
 * SHARED groups count once. Credit goes to the closer of the primary
 * (non-auto) close when known; otherwise the first DONE member's assignee.
 */
export function collapseSharedGroups(
  tasks: CreditTaskInput[],
): Map<string, CreditGroup> {
  const byGroup = new Map<string, CreditTaskInput[]>();
  const singles = new Map<string, CreditGroup>();

  for (const t of tasks) {
    if (t.groupId && t.completionMode === 'SHARED') {
      const list = byGroup.get(t.groupId) ?? [];
      list.push(t);
      byGroup.set(t.groupId, list);
    } else {
      singles.set(t.id, {
        taskId: t.id,
        creditUserId: t.closerActorId ?? t.assigneeId,
        memberIds: [t.id],
      });
    }
  }

  for (const [groupId, members] of byGroup) {
    const done = members.filter((m) => m.status === 'DONE');
    const withActor = done.find((m) => m.closerActorId);
    const primary = withActor ?? done[0] ?? members[0]!;
    singles.set(`group:${groupId}`, {
      taskId: primary.id,
      creditUserId: primary.closerActorId ?? primary.assigneeId,
      memberIds: members.map((m) => m.id),
    });
  }

  return singles;
}

/** Task ids that should be counted as one logical unit (rep id → all member ids). */
export function logicalTaskIds(
  collapse: Map<string, CreditGroup>,
): Set<string> {
  const reps = new Set<string>();
  for (const g of collapse.values()) {
    reps.add(g.taskId);
  }
  return reps;
}

export function isOnTime(
  dueAt: Date | null | undefined,
  completedAt: Date | null | undefined,
): boolean | null {
  if (!dueAt || !completedAt) return null;
  return completedAt.getTime() <= dueAt.getTime();
}

export function isOverdueOpen(
  status: string,
  dueAt: Date | null | undefined,
  now: Date,
): boolean {
  if (status === 'DONE' || status === 'CANCELLED') return false;
  return Boolean(dueAt && dueAt.getTime() < now.getTime());
}

export function ageBucketDays(
  createdAt: Date,
  now: Date,
): 'd0_1' | 'd2_3' | 'd4_7' | 'd8plus' {
  const days = Math.floor(
    (now.getTime() - createdAt.getTime()) / 86400000,
  );
  if (days <= 1) return 'd0_1';
  if (days <= 3) return 'd2_3';
  if (days <= 7) return 'd4_7';
  return 'd8plus';
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export function closeHours(createdAt: Date, completedAt: Date): number {
  return (completedAt.getTime() - createdAt.getTime()) / 3600000;
}

/**
 * Rating 0–100. Returns null when closedCount < RATING_MIN_CLOSED.
 * volumeScore = min(100, closed / teamMedianClosed * 100).
 * reworkScore = 100 − reworkPct (0 when no closed).
 */
export function computeRating(
  closedCount: number,
  onTimePct: number | null,
  teamMedianClosed: number,
  reworkPct: number | null = null,
): number | null {
  if (closedCount < RATING_MIN_CLOSED) return null;
  const onTimeScore = onTimePct ?? 0;
  const volumeBase = teamMedianClosed > 0 ? teamMedianClosed : 1;
  const volumeScore = Math.min(100, (closedCount / volumeBase) * 100);
  const reworkScore = Math.max(0, 100 - (reworkPct ?? 0));
  return Math.round(
    onTimeScore * RATING_ON_TIME_WEIGHT +
      volumeScore * RATING_VOLUME_WEIGHT +
      reworkScore * RATING_REWORK_WEIGHT,
  );
}

export function onTimePct(
  onTimeCount: number,
  withDueCount: number,
): number | null {
  if (withDueCount <= 0) return null;
  return Math.round((onTimeCount / withDueCount) * 100);
}
