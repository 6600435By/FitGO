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

/** Zones in the settings panel — top→bottom like the home screen. */
export type AdminHomeSettingsZoneId = 'top' | 'metrics' | 'tasks' | 'nav';

export interface AdminHomeWidgetDef {
  id: AdminHomeWidgetId;
  label: string;
  /** Where this appears on the home screen (settings panel). */
  hint?: string;
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
  /** Where this appears on the home screen (settings panel). */
  hint?: string;
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

export interface AdminHomeSettingsRow {
  kind: 'widget' | 'pin';
  id: AdminHomeWidgetId | AdminHomePinId;
  nested?: boolean;
}

export interface AdminHomeSettingsGroup {
  /** Optional subgroup title inside a zone (e.g. «Клиенты»). */
  label?: string;
  rows: AdminHomeSettingsRow[];
}

export interface AdminHomeSettingsZone {
  id: AdminHomeSettingsZoneId;
  label: string;
  /** Zone-level hint shown under the title. */
  hint?: string;
  groups: AdminHomeSettingsGroup[];
}

export const ADMIN_HOME_WIDGETS: AdminHomeWidgetDef[] = [
  {
    id: 'focus',
    label: 'Мой фокус',
    hint: 'очередь дел сверху экрана',
    modules: ['club_admin'],
  },
  {
    id: 'callToday',
    label: 'Позвонить сегодня',
    hint: 'список звонков справа (вместо фокуса)',
    modules: ['club_admin'],
  },
  {
    id: 'needsReview',
    label: 'Контроль записей',
    hint: 'карточка с числом',
    permission: 'CLIENTS_VIEW',
    modules: ['club_admin'],
  },
  {
    id: 'sessionsToday',
    label: 'Занятий сегодня',
    hint: 'карточка с числом',
    permission: 'CLIENTS_VIEW',
    modules: ['club_admin'],
  },
  {
    id: 'expiringSoon',
    label: 'Истекают скоро',
    hint: 'карточка с числом',
    modules: ['club_admin'],
  },
  {
    id: 'revenueToday',
    label: 'Выручка сегодня',
    hint: 'карточка с числом',
    modules: ['club_admin'],
  },
  {
    id: 'pendingCrm',
    label: 'Без 1С',
    hint: 'жёлтая полоса, только если очередь не пустая',
    permission: 'CLIENTS_VIEW',
    modules: ['club_admin'],
  },
  {
    id: 'tasks',
    label: 'Всего задач',
    hint: 'крупная цифра над чипами',
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
    hint: 'чип со счётчиком',
    modules: ['club_admin'],
  },
  {
    id: 'task:clients',
    label: 'Клиенты',
    shortLabel: 'Клиенты',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=calls',
    hint: 'чип со счётчиком',
    modules: ['club_admin'],
  },
  {
    id: 'task:membership',
    label: 'Абонементы по сроку',
    shortLabel: 'Абон.',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=calls',
    hint: 'чип со счётчиком',
    nested: true,
    modules: ['club_admin'],
  },
  {
    id: 'task:birthday',
    label: 'Дни рождения',
    shortLabel: 'ДР',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=birthday',
    hint: 'чип со счётчиком',
    nested: true,
    modules: ['club_admin'],
  },
  {
    id: 'task:client_debt',
    label: 'Долги клиентов',
    shortLabel: 'Долги',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=money&topic=client_debt',
    hint: 'чип со счётчиком',
    nested: true,
    modules: ['club_admin'],
  },
  {
    id: 'task:installment',
    label: 'Рассрочки',
    shortLabel: 'Расср.',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=money&topic=installment',
    hint: 'чип со счётчиком',
    nested: true,
    modules: ['club_admin'],
  },
  {
    id: 'task:staff',
    label: 'Персонал',
    shortLabel: 'Перс.',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=staff',
    hint: 'чип со счётчиком',
    modules: ['club_admin'],
  },
  {
    id: 'task:manager',
    label: 'Руководитель',
    shortLabel: 'Рук.',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=manager',
    hint: 'чип со счётчиком',
    modules: ['club_admin'],
  },
  {
    id: 'task:control',
    label: 'Подтвердить запись',
    shortLabel: 'Подтв. запись',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=control',
    hint: 'чип со счётчиком',
    modules: ['club_admin'],
  },
  {
    id: 'task:group_approval',
    label: 'ГП',
    shortLabel: 'ГП',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=control&topic=group_approval',
    hint: 'чип со счётчиком',
    nested: true,
    modules: ['club_admin', 'group_classes'],
  },
  {
    id: 'task:pt_approval',
    label: 'ПТ',
    shortLabel: 'ПТ',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=control&topic=pt_approval',
    hint: 'чип со счётчиком',
    nested: true,
    modules: ['club_admin', 'pt_sheet'],
  },
  {
    id: 'task:spa_approval',
    label: 'SPA',
    shortLabel: 'SPA',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=control&topic=spa_approval',
    hint: 'чип со счётчиком',
    nested: true,
    modules: ['club_admin', 'spa_booking'],
  },
  {
    id: 'task:confirmation',
    label: 'Подтверждения',
    shortLabel: 'Подтв.',
    kind: 'task',
    href: '/admin/tasks?view=now&kind=control&topic=confirmation',
    hint: 'чип со счётчиком',
    nested: true,
    modules: ['club_admin'],
  },
  {
    id: 'nav:/admin/booking-control',
    label: 'Записи',
    kind: 'nav',
    href: '/admin/booking-control',
    hint: 'кнопка под карточками',
    permission: 'CLIENTS_VIEW',
    modules: ['club_admin'],
  },
  {
    id: 'nav:/admin/schedule',
    label: 'Расписание',
    kind: 'nav',
    href: '/admin/schedule',
    hint: 'кнопка под карточками',
    permission: 'CLIENTS_VIEW',
    modules: ['club_admin', 'group_classes'],
  },
  {
    id: 'nav:/admin/spa',
    label: 'SPA',
    kind: 'nav',
    href: '/admin/spa',
    hint: 'кнопка под карточками',
    permission: 'CLIENTS_VIEW',
    modules: ['club_admin', 'spa_booking'],
  },
  {
    id: 'nav:/admin/staff-roster',
    label: 'График смен',
    kind: 'nav',
    href: '/admin/staff-roster',
    hint: 'кнопка под карточками',
    permission: 'CLIENTS_VIEW',
    modules: ['club_admin'],
  },
  {
    id: 'nav:/admin/pt-timesheet',
    label: 'Табели ПТ',
    kind: 'nav',
    href: '/admin/pt-timesheet',
    hint: 'кнопка под карточками',
    permission: 'CLIENTS_VIEW',
    modules: ['club_admin', 'pt_sheet'],
  },
  {
    id: 'nav:/admin/sales',
    label: 'Продажи',
    kind: 'nav',
    href: '/admin/sales',
    hint: 'кнопка под карточками',
    modules: ['club_admin'],
  },
  {
    id: 'nav:/admin/payroll',
    label: 'Моя ЗП',
    kind: 'nav',
    href: '/admin/payroll',
    hint: 'кнопка под карточками',
    modules: ['club_admin'],
  },
  {
    id: 'nav:/admin/reports',
    label: 'Отчёты',
    kind: 'nav',
    href: '/admin/reports',
    hint: 'кнопка под карточками',
    permission: 'REPORTS_VIEW',
    modules: ['club_admin'],
  },
  {
    id: 'nav:/admin/at-risk',
    label: 'Зона риска',
    kind: 'nav',
    href: '/admin/at-risk',
    hint: 'кнопка под карточками',
    permission: 'AT_RISK_VIEW',
    anyOf: ['CLIENTS_VIEW'],
    modules: ['club_admin'],
  },
  {
    id: 'nav:/admin/funnel',
    label: 'Воронка',
    kind: 'nav',
    href: '/admin/funnel',
    hint: 'кнопка под карточками',
    permission: 'FUNNEL_VIEW',
    modules: ['club_admin'],
  },
  {
    id: 'nav:/admin/pending-crm',
    label: 'Очередь без 1С',
    kind: 'nav',
    href: '/admin/pending-crm',
    hint: 'кнопка под карточками',
    permission: 'CLIENTS_VIEW',
    modules: ['club_admin'],
  },
  {
    id: 'nav:/admin/notifications',
    label: 'Сообщения',
    kind: 'nav',
    href: '/admin/notifications',
    hint: 'кнопка под карточками',
    permission: 'NOTIFICATIONS_SEND',
    modules: ['club_admin', 'messaging'],
  },
  {
    id: 'nav:/admin/tasks',
    label: 'Задачи',
    kind: 'nav',
    href: '/admin/tasks',
    hint: 'кнопка под карточками',
    modules: ['club_admin'],
  },
];

/**
 * Settings panel layout: zones match the home screen top→bottom.
 * Groups keep parent/child rows in one column (no 2-col split).
 */
export const ADMIN_HOME_SETTINGS_ZONES: AdminHomeSettingsZone[] = [
  {
    id: 'top',
    label: 'Верх',
    hint: 'Выберите один блок — фокус или список звонков',
    groups: [
      {
        rows: [
          { kind: 'widget', id: 'focus' },
          { kind: 'widget', id: 'callToday' },
        ],
      },
    ],
  },
  {
    id: 'metrics',
    label: 'Цифры',
    hint: 'Карточки с числами под верхним блоком',
    groups: [
      {
        rows: [
          { kind: 'widget', id: 'needsReview' },
          { kind: 'widget', id: 'sessionsToday' },
          { kind: 'widget', id: 'expiringSoon' },
          { kind: 'widget', id: 'revenueToday' },
          { kind: 'widget', id: 'pendingCrm' },
        ],
      },
    ],
  },
  {
    id: 'tasks',
    label: 'Задачи',
    hint: 'Блок задач: цифра «всего» и чипы-счётчики',
    groups: [
      {
        rows: [{ kind: 'widget', id: 'tasks' }],
      },
      {
        rows: [{ kind: 'pin', id: 'task:all' }],
      },
      {
        label: 'Клиенты',
        rows: [
          { kind: 'pin', id: 'task:clients' },
          { kind: 'pin', id: 'task:membership', nested: true },
          { kind: 'pin', id: 'task:birthday', nested: true },
          { kind: 'pin', id: 'task:client_debt', nested: true },
          { kind: 'pin', id: 'task:installment', nested: true },
        ],
      },
      {
        rows: [
          { kind: 'pin', id: 'task:staff' },
          { kind: 'pin', id: 'task:manager' },
        ],
      },
      {
        label: 'Подтвердить запись',
        rows: [
          { kind: 'pin', id: 'task:control' },
          { kind: 'pin', id: 'task:group_approval', nested: true },
          { kind: 'pin', id: 'task:pt_approval', nested: true },
          { kind: 'pin', id: 'task:spa_approval', nested: true },
          { kind: 'pin', id: 'task:confirmation', nested: true },
        ],
      },
    ],
  },
  {
    id: 'nav',
    label: 'Кнопки внизу',
    hint: 'Быстрые переходы под карточками',
    groups: [
      {
        label: 'Сегодня',
        rows: [{ kind: 'pin', id: 'nav:/admin/tasks' }],
      },
      {
        label: 'Зал',
        rows: [
          { kind: 'pin', id: 'nav:/admin/booking-control' },
          { kind: 'pin', id: 'nav:/admin/schedule' },
          { kind: 'pin', id: 'nav:/admin/spa' },
          { kind: 'pin', id: 'nav:/admin/staff-roster' },
          { kind: 'pin', id: 'nav:/admin/pt-timesheet' },
        ],
      },
      {
        label: 'Деньги',
        rows: [
          { kind: 'pin', id: 'nav:/admin/sales' },
          { kind: 'pin', id: 'nav:/admin/payroll' },
          { kind: 'pin', id: 'nav:/admin/reports' },
        ],
      },
      {
        label: 'Клиенты',
        rows: [
          { kind: 'pin', id: 'nav:/admin/at-risk' },
          { kind: 'pin', id: 'nav:/admin/funnel' },
          { kind: 'pin', id: 'nav:/admin/pending-crm' },
          { kind: 'pin', id: 'nav:/admin/notifications' },
        ],
      },
    ],
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
  'task:birthday',
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
  /** Kept for API/compat; panel uses «Как у всех» instead. */
  all: {
    label: 'Всё',
    widgets: [...ADMIN_HOME_DEFAULT_WIDGETS],
    pins: [...ADMIN_HOME_DEFAULT_PINS],
  },
};

/** Presets shown as quick-start chips (no «Всё»). */
export const ADMIN_HOME_PANEL_PRESETS: Exclude<AdminHomePresetId, 'all'>[] = [
  'reception',
  'floor',
  'money',
];

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

/**
 * Home shows callToday only when focus is off — drop the hidden one from saves.
 */
export function normalizeAdminHomeWidgets(
  widgets: AdminHomeWidgetId[],
): AdminHomeWidgetId[] {
  if (widgets.includes('focus') && widgets.includes('callToday')) {
    return ADMIN_HOME_WIDGETS.map((w) => w.id).filter(
      (id) => widgets.includes(id) && id !== 'callToday',
    );
  }
  return ADMIN_HOME_WIDGETS.map((w) => w.id).filter((id) =>
    widgets.includes(id),
  );
}

/**
 * Toggle a widget; focus and callToday are mutually exclusive
 * so saved layout matches what the home screen shows.
 */
export function toggleAdminHomeWidget(
  widgets: AdminHomeWidgetId[],
  id: AdminHomeWidgetId,
  on: boolean,
): AdminHomeWidgetId[] {
  const set = new Set(widgets);
  if (on) {
    set.add(id);
    if (id === 'focus') set.delete('callToday');
    if (id === 'callToday') set.delete('focus');
  } else {
    set.delete(id);
  }
  return normalizeAdminHomeWidgets(
    ADMIN_HOME_WIDGETS.map((w) => w.id).filter((w) => set.has(w)),
  );
}

export function toggleAdminHomePin(
  pins: AdminHomePinId[],
  id: AdminHomePinId,
  on: boolean,
): AdminHomePinId[] {
  const set = new Set(pins);
  if (on) set.add(id);
  else set.delete(id);
  return ADMIN_HOME_PINS.map((p) => p.id).filter((p) => set.has(p));
}

function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * Which panel preset matches the current selection (order-independent).
 * Pass permissions + isEnabled so module-gated pins/widgets are ignored
 * the same way as when applying the preset.
 */
export function matchingAdminHomePreset(
  widgets: AdminHomeWidgetId[],
  pins: AdminHomePinId[],
  permissions?: string[],
  isEnabled?: (m: string) => boolean,
): Exclude<AdminHomePresetId, 'all'> | null {
  const filter =
    permissions && isEnabled
      ? (item: {
          permission?: string;
          anyOf?: string[];
          modules?: string[];
        }) => adminHomeItemAllowed(item, permissions, isEnabled)
      : () => true;

  for (const id of ADMIN_HOME_PANEL_PRESETS) {
    const preset = ADMIN_HOME_PRESETS[id];
    const expectedWidgets = preset.widgets.filter((w) => {
      const def = adminHomeWidgetDef(w);
      return def ? filter(def) : false;
    });
    const expectedPins = preset.pins.filter((p) => {
      const def = adminHomePinDef(p);
      return def ? filter(def) : false;
    });
    if (
      sameIdSet(widgets, expectedWidgets) &&
      sameIdSet(pins, expectedPins)
    ) {
      return id;
    }
  }
  return null;
}

export function adminHomeWidgetDef(
  id: AdminHomeWidgetId,
): AdminHomeWidgetDef | undefined {
  return ADMIN_HOME_WIDGETS.find((w) => w.id === id);
}

export function adminHomePinDef(id: AdminHomePinId): AdminHomePinDef | undefined {
  return ADMIN_HOME_PINS.find((p) => p.id === id);
}
