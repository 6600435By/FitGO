/** Personal /admin home layout: widgets (data cards) and pins (task chips + nav buttons). */

export type AdminHomeWidgetId =
  | 'tasks'
  | 'focus'
  | 'needsReview'
  | 'expiringSoon'
  | 'sessionsToday'
  | 'revenueToday'
  | 'callToday'
  | 'pendingCrm';

export type AdminHomePinId =
  | 'task:all'
  | 'task:clients'
  | 'task:membership'
  | 'task:birthday'
  | 'task:client_debt'
  | 'task:installment'
  | 'task:staff'
  | 'task:manager'
  | 'task:control'
  | 'task:group_approval'
  | 'task:pt_approval'
  | 'task:spa_approval'
  | 'task:confirmation'
  | 'nav:/admin/booking-control'
  | 'nav:/admin/schedule'
  | 'nav:/admin/spa'
  | 'nav:/admin/staff-roster'
  | 'nav:/admin/pt-timesheet'
  | 'nav:/admin/sales'
  | 'nav:/admin/payroll'
  | 'nav:/admin/reports'
  | 'nav:/admin/at-risk'
  | 'nav:/admin/funnel'
  | 'nav:/admin/pending-crm'
  | 'nav:/admin/notifications'
  | 'nav:/admin/tasks';

export type AdminHomePresetId = 'reception' | 'floor' | 'money' | 'all';

export interface AdminHomeWidgetDef {
  id: AdminHomeWidgetId;
  label: string;
  /** AdminPermission value */
  permission?: string;
  anyOf?: string[];
  /** ProductModuleKey values */
  modules?: string[];
}

export interface AdminHomePinDef {
  id: AdminHomePinId;
  label: string;
  /** Short label for chips on the home grid. */
  shortLabel?: string;
  kind: 'task' | 'nav';
  href: string;
  /** Indent under a parent group in the settings panel. */
  nested?: boolean;
  permission?: string;
  anyOf?: string[];
  modules?: string[];
}

export interface AdminHomeLayoutValue {
  /** null = never customized (show default). Explicit [] = all off. */
  widgets: AdminHomeWidgetId[] | null;
  pins: AdminHomePinId[] | null;
}

export const ADMIN_HOME_WIDGETS: AdminHomeWidgetDef[] = [
  { id: 'focus', label: 'Мой фокус', modules: ['club_admin'] },
  { id: 'tasks', label: 'Задачи (чипы)', modules: ['club_admin'] },
  {
    id: 'needsReview',
    label: 'Контроль записей',
    permission: 'CLIENTS_VIEW',
    modules: ['club_admin'],
  },
  {
    id: 'expiringSoon',
    label: 'Истекают скоро',
    modules: ['club_admin'],
  },
  {
    id: 'sessionsToday',
    label: 'Занятий сегодня',
    permission: 'CLIENTS_VIEW',
    modules: ['club_admin'],
  },
  {
    id: 'revenueToday',
    label: 'Выручка сегодня',
    modules: ['club_admin'],
  },
  {
    id: 'callToday',
    label: 'Позвонить сегодня',
    modules: ['club_admin'],
  },
  {
    id: 'pendingCrm',
    label: 'Без 1С',
    permission: 'CLIENTS_VIEW',
    modules: ['club_admin'],
  },
];

export const ADMIN_HOME_PINS: AdminHomePinDef[] = [
  {
    id: 'task:all',
    label: 'Все задачи',
    shortLabel: 'Все',
    kind: 'task',
    href: '/admin/tasks?view=now',
    modules: ['club_admin'],
  },
  {
    id: 'task:clients',
    label: 'Клиенты',
    shortLabel: 'Клиенты',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=calls',
    modules: ['club_admin'],
  },
  {
    id: 'task:membership',
    label: 'По сроку',
    shortLabel: 'Абон.',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=calls&topic=membership',
    nested: true,
    modules: ['club_admin'],
  },
  {
    id: 'task:birthday',
    label: 'Дни рождения',
    shortLabel: 'ДР',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=calls&topic=birthday',
    nested: true,
    modules: ['club_admin'],
  },
  {
    id: 'task:client_debt',
    label: 'Долги клиентов',
    shortLabel: 'Долги',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=money&topic=client_debt',
    nested: true,
    modules: ['club_admin'],
  },
  {
    id: 'task:installment',
    label: 'Рассрочки',
    shortLabel: 'Расср.',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=money&topic=installment',
    nested: true,
    modules: ['club_admin'],
  },
  {
    id: 'task:staff',
    label: 'Персонал',
    shortLabel: 'Перс.',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=staff',
    modules: ['club_admin'],
  },
  {
    id: 'task:manager',
    label: 'Руководитель',
    shortLabel: 'Рук.',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=manager',
    modules: ['club_admin'],
  },
  {
    id: 'task:control',
    label: 'Контроль',
    shortLabel: 'Контроль',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=control',
    modules: ['club_admin'],
  },
  {
    id: 'task:group_approval',
    label: 'ГП',
    shortLabel: 'ГП',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=control&topic=group_approval',
    nested: true,
    modules: ['club_admin', 'group_classes'],
  },
  {
    id: 'task:pt_approval',
    label: 'ПТ',
    shortLabel: 'ПТ',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=control&topic=pt_approval',
    nested: true,
    modules: ['club_admin', 'pt_sheet'],
  },
  {
    id: 'task:spa_approval',
    label: 'SPA',
    shortLabel: 'SPA',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=control&topic=spa_approval',
    nested: true,
    modules: ['club_admin', 'spa_booking'],
  },
  {
    id: 'task:confirmation',
    label: 'Подтверждения',
    shortLabel: 'Подтв.',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=control&topic=confirmation',
    nested: true,
    modules: ['club_admin'],
  },
  {
    id: 'nav:/admin/booking-control',
    label: 'Записи',
    kind: 'nav',
    href: '/admin/booking-control',
    permission: 'CLIENTS_VIEW',
    modules: ['club_admin'],
  },
  {
    id: 'nav:/admin/schedule',
    label: 'Расписание',
    kind: 'nav',
    href: '/admin/schedule',
    permission: 'CLIENTS_VIEW',
    modules: ['club_admin', 'group_classes'],
  },
  {
    id: 'nav:/admin/spa',
    label: 'SPA',
    kind: 'nav',
    href: '/admin/spa',
    permission: 'CLIENTS_VIEW',
    modules: ['club_admin', 'spa_booking'],
  },
  {
    id: 'nav:/admin/staff-roster',
    label: 'График смен',
    kind: 'nav',
    href: '/admin/staff-roster',
    permission: 'CLIENTS_VIEW',
    modules: ['club_admin'],
  },
  {
    id: 'nav:/admin/pt-timesheet',
    label: 'Табели ПТ',
    kind: 'nav',
    href: '/admin/pt-timesheet',
    permission: 'CLIENTS_VIEW',
    modules: ['club_admin', 'pt_sheet'],
  },
  {
    id: 'nav:/admin/sales',
    label: 'Продажи',
    kind: 'nav',
    href: '/admin/sales',
    modules: ['club_admin'],
  },
  {
    id: 'nav:/admin/payroll',
    label: 'Моя ЗП',
    kind: 'nav',
    href: '/admin/payroll',
    modules: ['club_admin'],
  },
  {
    id: 'nav:/admin/reports',
    label: 'Отчёты',
    kind: 'nav',
    href: '/admin/reports',
    permission: 'REPORTS_VIEW',
    modules: ['club_admin'],
  },
  {
    id: 'nav:/admin/at-risk',
    label: 'Зона риска',
    kind: 'nav',
    href: '/admin/at-risk',
    permission: 'AT_RISK_VIEW',
    anyOf: ['CLIENTS_VIEW'],
    modules: ['club_admin'],
  },
  {
    id: 'nav:/admin/funnel',
    label: 'Воронка',
    kind: 'nav',
    href: '/admin/funnel',
    permission: 'FUNNEL_VIEW',
    modules: ['club_admin'],
  },
  {
    id: 'nav:/admin/pending-crm',
    label: 'Без 1С',
    kind: 'nav',
    href: '/admin/pending-crm',
    permission: 'CLIENTS_VIEW',
    modules: ['club_admin'],
  },
  {
    id: 'nav:/admin/notifications',
    label: 'Сообщения',
    kind: 'nav',
    href: '/admin/notifications',
    permission: 'NOTIFICATIONS_SEND',
    modules: ['club_admin', 'messaging'],
  },
  {
    id: 'nav:/admin/tasks',
    label: 'Задачи',
    kind: 'nav',
    href: '/admin/tasks',
    modules: ['club_admin'],
  },
];

/** Current home screen before any personalization. */
export const ADMIN_HOME_DEFAULT_WIDGETS: AdminHomeWidgetId[] = [
  'focus',
  'needsReview',
  'expiringSoon',
  'sessionsToday',
  'revenueToday',
  'pendingCrm',
];

/** Default chips inside the Tasks card (matches current /admin). */
export const ADMIN_HOME_DEFAULT_TASK_PINS: AdminHomePinId[] = [
  'task:control',
  'task:membership',
  'task:group_approval',
  'task:spa_approval',
  'task:pt_approval',
  'task:manager',
];

/** Default section buttons under callToday (matches current /admin). */
export const ADMIN_HOME_DEFAULT_NAV_PINS: AdminHomePinId[] = [
  'nav:/admin/at-risk',
  'nav:/admin/reports',
];

export const ADMIN_HOME_DEFAULT_PINS: AdminHomePinId[] = [
  ...ADMIN_HOME_DEFAULT_TASK_PINS,
  ...ADMIN_HOME_DEFAULT_NAV_PINS,
];

export const ADMIN_HOME_PRESETS: Record<
  AdminHomePresetId,
  {
    label: string;
    widgets: AdminHomeWidgetId[];
    pins: AdminHomePinId[];
  }
> = {
  reception: {
    label: 'Рецепция',
    widgets: [
      'focus',
      'needsReview',
      'sessionsToday',
      'expiringSoon',
      'pendingCrm',
    ],
    pins: [
      ...ADMIN_HOME_DEFAULT_TASK_PINS,
      'nav:/admin/booking-control',
      'nav:/admin/tasks',
    ],
  },
  floor: {
    label: 'Зал',
    widgets: ['focus', 'sessionsToday', 'needsReview'],
    pins: [
      ...ADMIN_HOME_DEFAULT_TASK_PINS,
      'nav:/admin/schedule',
      'nav:/admin/spa',
      'nav:/admin/staff-roster',
      'nav:/admin/pt-timesheet',
    ],
  },
  money: {
    label: 'Деньги',
    widgets: ['revenueToday', 'focus'],
    pins: [
      ...ADMIN_HOME_DEFAULT_TASK_PINS,
      'nav:/admin/sales',
      'nav:/admin/payroll',
      'nav:/admin/reports',
    ],
  },
  all: {
    label: 'Всё',
    widgets: [...ADMIN_HOME_DEFAULT_WIDGETS],
    pins: [...ADMIN_HOME_DEFAULT_PINS],
  },
};

const WIDGET_IDS = new Set<string>(ADMIN_HOME_WIDGETS.map((w) => w.id));
const PIN_IDS = new Set<string>(ADMIN_HOME_PINS.map((p) => p.id));

export function isAdminHomeWidgetId(id: string): id is AdminHomeWidgetId {
  return WIDGET_IDS.has(id);
}

export function isAdminHomePinId(id: string): id is AdminHomePinId {
  return PIN_IDS.has(id);
}

export function adminHomeItemAllowed(
  item: {
    permission?: string;
    anyOf?: string[];
    modules?: string[];
  },
  permissions: string[],
  isEnabled: (m: string) => boolean,
): boolean {
  if (item.modules?.some((m) => !isEnabled(m))) return false;
  if (item.permission && !permissions.includes(item.permission)) {
    if (!item.anyOf?.some((p) => permissions.includes(p))) return false;
  }
  return true;
}

export function filterAdminHomeWidgets(
  widgets: AdminHomeWidgetId[] | null | undefined,
  permissions: string[],
  isEnabled: (m: string) => boolean,
): AdminHomeWidgetId[] | null {
  if (widgets == null) return null;
  return widgets.filter((id) => {
    const def = ADMIN_HOME_WIDGETS.find((w) => w.id === id);
    return def ? adminHomeItemAllowed(def, permissions, isEnabled) : false;
  });
}

export function filterAdminHomePins(
  pins: AdminHomePinId[] | null | undefined,
  permissions: string[],
  isEnabled: (m: string) => boolean,
): AdminHomePinId[] | null {
  if (pins == null) return null;
  return pins.filter((id) => {
    const def = ADMIN_HOME_PINS.find((p) => p.id === id);
    return def ? adminHomeItemAllowed(def, permissions, isEnabled) : false;
  });
}

/** Materialize null → default lists for the first edit. */
export function materializeAdminHomeLayout(
  layout: AdminHomeLayoutValue,
): { widgets: AdminHomeWidgetId[]; pins: AdminHomePinId[] } {
  return {
    widgets: layout.widgets ?? [...ADMIN_HOME_DEFAULT_WIDGETS],
    pins: layout.pins ?? [...ADMIN_HOME_DEFAULT_PINS],
  };
}
