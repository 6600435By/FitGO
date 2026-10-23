import type {
  AdminTaskAssignMode,
  AdminTaskDuePolicy,
  AdminTaskRuleSource,
} from '@fitgo/shared-types';

export type AdminTaskRuleSourceKey = AdminTaskRuleSource;

export interface AdminTaskRuleCatalogEntry {
  source: AdminTaskRuleSourceKey;
  label: string;
  /** Default params when no DB row exists. */
  defaultParams: Record<string, unknown>;
}

/** Known auto-task generators — missing DB row = enabled with these defaults. */
export const ADMIN_TASK_RULE_CATALOG: AdminTaskRuleCatalogEntry[] = [
  {
    source: 'CLIENT_DEBT',
    label: 'Долг клиента',
    defaultParams: { minAmount: 0 },
  },
  {
    source: 'STAFF_DEBT',
    label: 'Долг сотрудника',
    defaultParams: { minAmount: 0 },
  },
  {
    source: 'MEMBERSHIP_EXPIRING',
    label: 'Абонемент истекает',
    defaultParams: { daysAhead: 14 },
  },
  {
    source: 'INSTALLMENT_PAYMENT',
    label: 'Рассрочка',
    defaultParams: { daysBeforePayment: 3 },
  },
  {
    source: 'BIRTHDAY',
    label: 'День рождения',
    defaultParams: {},
  },
  {
    source: 'BOOKING_CONFIRM',
    label: 'Подтверждение записи',
    defaultParams: {},
  },
  {
    source: 'TRAINING_SALE_NO_PERFORMER',
    label: 'Продажа ПТ без исполнителя',
    defaultParams: { lookbackDays: 14 },
  },
];

export const ADMIN_TASK_RULE_SOURCES = new Set(
  ADMIN_TASK_RULE_CATALOG.map((c) => c.source),
);

export function defaultRuleForSource(source: AdminTaskRuleSourceKey) {
  const cat = ADMIN_TASK_RULE_CATALOG.find((c) => c.source === source)!;
  return {
    source: cat.source,
    label: cat.label,
    enabled: true,
    assignMode: 'POOL' as AdminTaskAssignMode,
    assigneeIds: [] as string[],
    duePolicy: 'END_OF_DAY' as AdminTaskDuePolicy,
    dueHours: null as number | null,
    params: { ...cat.defaultParams },
  };
}
