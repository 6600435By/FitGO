'use client';

import {
  ADMIN_HOME_DEFAULT_NAV_PINS,
  ADMIN_HOME_DEFAULT_PINS,
  ADMIN_HOME_DEFAULT_TASK_PINS,
  ADMIN_HOME_DEFAULT_WIDGETS,
  ADMIN_HOME_PINS,
  adminHomeItemAllowed,
  type AdminHomeLayoutValue,
  type AdminHomePinId,
  type AdminHomeWidgetId,
  type AdminPermission,
  type ProductModuleKey,
} from '@fitgo/shared-types';
import {
  AlertTriangle,
  Bell,
  CalendarCheck,
  ClipboardCheck,
  ListTodo,
  Settings2,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminHomeSettings } from '@/components/admin/admin-home-settings';
import { AdminFocusCard } from '@/components/admin/tasks/admin-focus-card';
import { useFeatures } from '@/components/features-provider';
import { api, type AdminDashboard } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import { cn, formatDate } from '@/lib/utils';

/** Keep last dashboard while remounting tabs — avoid full-page spinner. */
let dashboardCache: AdminDashboard | null = null;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function money(n: number, currency: string) {
  return `${n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ${currency}`;
}

function syncedLabel(iso?: string) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `обновлено ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}

function emptyTasks() {
  return {
    total: 0,
    bookingControl: 0,
    membership: 0,
    group: 0,
    spa: 0,
    pt: 0,
    manager: 0,
    birthday: 0,
    clientDebt: 0,
    staffDebt: 0,
    installment: 0,
    confirmation: 0,
    clients: 0,
    control: 0,
  };
}

function pinCount(
  id: AdminHomePinId,
  tasks: ReturnType<typeof emptyTasks>,
): number {
  switch (id) {
    case 'task:all':
      return tasks.total;
    case 'task:clients':
      return (
        tasks.clients ??
        tasks.membership +
          (tasks.birthday ?? 0) +
          (tasks.clientDebt ?? 0) +
          (tasks.installment ?? 0)
      );
    case 'task:membership':
      return tasks.membership;
    case 'task:birthday':
      return tasks.birthday ?? 0;
    case 'task:client_debt':
      return tasks.clientDebt ?? 0;
    case 'task:installment':
      return tasks.installment ?? 0;
    case 'task:staff':
      return tasks.staffDebt ?? 0;
    case 'task:manager':
      return tasks.manager;
    case 'task:control':
      return tasks.control ?? tasks.bookingControl;
    case 'task:group_approval':
      return tasks.group;
    case 'task:pt_approval':
      return tasks.pt;
    case 'task:spa_approval':
      return tasks.spa;
    case 'task:confirmation':
      return tasks.confirmation ?? 0;
    default:
      return 0;
  }
}

function TaskChip({
  href,
  label,
  value,
}: {
  href: string;
  label: string;
  value: number;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-9 flex-col justify-center rounded-xl bg-slate-800/60 px-2 py-1 transition hover:bg-slate-800 sm:min-h-10 sm:px-2.5 sm:py-1.5"
    >
      <span className="text-[10px] leading-tight text-slate-500 sm:text-[11px]">
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums text-white sm:text-base">
        {value}
      </span>
    </Link>
  );
}

function NavPinButton({
  href,
  label,
  primary,
  stretch,
}: {
  href: string;
  label: string;
  primary?: boolean;
  stretch?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        primary ? 'btn-primary' : 'btn-secondary',
        stretch
          ? 'flex w-full items-center justify-center !px-3 !py-2 text-center text-sm sm:w-auto sm:flex-none'
          : 'inline-flex flex-1 items-center justify-center !px-3 !py-2 text-center text-sm sm:flex-none',
        'line-clamp-2',
      )}
    >
      {label}
    </Link>
  );
}

export default function AdminHomePage() {
  const { isEnabled, loading: featuresLoading } = useFeatures();
  const [data, setData] = useState<AdminDashboard | null>(dashboardCache);
  const [error, setError] = useState('');
  const [layout, setLayout] = useState<AdminHomeLayoutValue>({
    widgets: null,
    pins: null,
  });
  const [permissions, setPermissions] = useState<AdminPermission[]>([]);
  const [editing, setEditing] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);

  const loadLayout = useCallback(() => {
    const token = getToken();
    if (!token) return;
    api
      .adminHomeLayout(token)
      .then(setLayout)
      .catch(() => setLayout({ widgets: null, pins: null }))
      .finally(() => setLayoutReady(true));
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    api
      .adminDashboard(token)
      .then((next) => {
        dashboardCache = next;
        setData(next);
      })
      .catch((err) => {
        if (!dashboardCache) setError(err.message);
      });

    api
      .adminPermissions(token)
      .then(({ permissions: p }) => setPermissions(p))
      .catch(() => setPermissions([]));

    loadLayout();
  }, [loadLayout]);

  const effectiveWidgets = useMemo((): AdminHomeWidgetId[] => {
    if (layout.widgets == null) return [...ADMIN_HOME_DEFAULT_WIDGETS];
    return layout.widgets;
  }, [layout.widgets]);

  const effectivePins = useMemo((): AdminHomePinId[] => {
    if (layout.pins == null) return [...ADMIN_HOME_DEFAULT_PINS];
    return layout.pins;
  }, [layout.pins]);

  const showWidget = useCallback(
    (id: AdminHomeWidgetId) => effectiveWidgets.includes(id),
    [effectiveWidgets],
  );

  const allowedPin = useCallback(
    (id: AdminHomePinId) => {
      const def = ADMIN_HOME_PINS.find((p) => p.id === id);
      if (!def) return false;
      return adminHomeItemAllowed(
        def,
        permissions as string[],
        (m) => isEnabled(m as ProductModuleKey),
      );
    },
    [permissions, isEnabled],
  );

  const taskPins = useMemo(() => {
    const selected = effectivePins.filter(
      (id) => id.startsWith('task:') && allowedPin(id),
    );
    if (layout.pins == null) {
      return ADMIN_HOME_DEFAULT_TASK_PINS.filter(allowedPin);
    }
    return ADMIN_HOME_PINS.filter(
      (p) => p.kind === 'task' && selected.includes(p.id),
    ).map((p) => p.id);
  }, [effectivePins, allowedPin, layout.pins]);

  const navPins = useMemo(() => {
    const selected = effectivePins.filter(
      (id) => id.startsWith('nav:') && allowedPin(id),
    );
    if (layout.pins == null) {
      return ADMIN_HOME_DEFAULT_NAV_PINS.filter(allowedPin);
    }
    return ADMIN_HOME_PINS.filter(
      (p) => p.kind === 'nav' && selected.includes(p.id),
    ).map((p) => p.id);
  }, [effectivePins, allowedPin, layout.pins]);

  const persistLayout = async (next: {
    widgets: AdminHomeWidgetId[];
    pins: AdminHomePinId[];
  }) => {
    const prev = layout;
    setLayout(next);
    const token = getToken();
    if (!token) return;
    try {
      const saved = await api.adminPutHomeLayout(token, next);
      setLayout(saved);
    } catch {
      setLayout(prev);
    }
  };

  const resetLayout = async () => {
    const prev = layout;
    setLayout({ widgets: null, pins: null });
    const token = getToken();
    if (!token) return;
    try {
      const saved = await api.adminResetHomeLayout(token);
      setLayout(saved);
    } catch {
      setLayout(prev);
    }
  };

  const showAll = () => {
    void persistLayout({
      widgets: [...ADMIN_HOME_DEFAULT_WIDGETS],
      pins: [...ADMIN_HOME_DEFAULT_PINS],
    });
  };

  if (error) return <p className="text-red-400">{error}</p>;

  if (!data || !layoutReady || featuresLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  const today = todayIso();
  const from30 = daysAgoIso(30);
  const currency = data.stats.revenueToday.currency || 'BYN';
  const reviewHref = `/admin/booking-control?needsReview=1&from=${from30}&to=${today}`;
  const revenueSynced = syncedLabel(data.stats.revenueToday.syncedAt);
  const tasks = { ...emptyTasks(), ...data.stats.tasks };

  const callPreview = data.callToday.slice(0, 2);
  const callExtra = Math.max(0, data.callToday.length - callPreview.length);

  const showFocus = showWidget('focus');
  const showTasksCard = showWidget('tasks');
  const showTasksBlock = showTasksCard || taskPins.length > 0;
  const showCall = showWidget('callToday') && !showFocus;
  const showPendingCrm =
    showWidget('pendingCrm') && (data.stats.pendingCrmCount ?? 0) > 0;

  const metricIds = (
    [
      'needsReview',
      'expiringSoon',
      'sessionsToday',
      'revenueToday',
    ] as AdminHomeWidgetId[]
  ).filter(showWidget);

  const metricCount = metricIds.length;
  const metricsClass =
    metricCount === 1
      ? 'grid grid-cols-1 gap-2'
      : metricCount === 2
        ? 'grid grid-cols-2 gap-2 md:gap-3'
        : metricCount === 3
          ? 'grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-3'
          : 'grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3';

  const navUnderCall = showCall && navPins.length > 0 && navPins.length <= 2;
  const navFullWidth = navPins.length > 0 && !navUnderCall;

  const hasLeft =
    showFocus ||
    showTasksBlock ||
    metricCount > 0 ||
    showPendingCrm;
  const hasRight = showCall;
  const emptyHome =
    !hasLeft && !hasRight && navPins.length === 0 && !editing;

  const gridClass = hasLeft && hasRight
    ? 'grid gap-2 sm:gap-4 lg:grid-cols-3'
    : 'grid gap-2 sm:gap-4';

  const accountUser = getUser();
  const accountFio = [accountUser?.lastName, accountUser?.firstName]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="mx-auto max-w-6xl space-y-2 sm:space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {data.club || accountFio ? (
          <p className="min-w-0 text-xs text-slate-400 sm:text-sm">
            {data.club ? (
              <>
                Клуб{' '}
                <span className="font-medium text-white">{data.club.name}</span>
              </>
            ) : null}
            {data.club && accountFio ? (
              <span className="text-slate-600"> · </span>
            ) : null}
            {accountFio ? (
              <span className="font-medium text-white">{accountFio}</span>
            ) : null}
          </p>
        ) : (
          <span />
        )}
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-1.5 !px-2.5 !py-1.5 text-xs"
          onClick={() => setEditing((v) => !v)}
        >
          <Settings2 className="h-3.5 w-3.5" />
          {editing ? 'Скрыть' : 'Настроить'}
        </button>
      </div>

      {editing ? (
        <AdminHomeSettings
          layout={layout}
          permissions={permissions}
          isEnabled={isEnabled}
          onChange={(next) => void persistLayout(next)}
          onReset={() => void resetLayout()}
          onClose={() => setEditing(false)}
        />
      ) : null}

      {emptyHome ? (
        <div className="card space-y-3 text-center !p-4">
          <p className="text-sm text-slate-300">
            На главном экране ничего не выбрано
          </p>
          <button type="button" className="btn-primary" onClick={showAll}>
            Показать всё
          </button>
        </div>
      ) : null}

      <div className={gridClass}>
        {hasLeft ? (
          <div
            className={cn(
              'space-y-2 sm:space-y-3',
              hasRight ? 'lg:col-span-2' : '',
            )}
          >
            {showFocus ? <AdminFocusCard /> : null}

            {showTasksBlock ? (
              <div className="card !p-3 sm:!p-4">
                <div className="flex items-start gap-2 sm:gap-3">
                  <ListTodo className="mt-0.5 h-4 w-4 shrink-0 text-fitgo-400 sm:h-5 sm:w-5" />
                  <div className="min-w-0 flex-1">
                    {showTasksCard ? (
                      <div className="flex flex-wrap items-end justify-between gap-2">
                        <div>
                          <p className="stat-label">Задачи</p>
                          <Link
                            href="/admin/tasks?view=now"
                            className="stat-value text-2xl leading-none hover:text-fitgo-300 sm:text-3xl"
                          >
                            {tasks.total}
                          </Link>
                        </div>
                        <Link
                          href="/admin/tasks?view=now"
                          className="text-xs text-slate-500 hover:text-fitgo-400"
                        >
                          Все задачи →
                        </Link>
                      </div>
                    ) : null}
                    {taskPins.length > 0 ? (
                      <div
                        className={cn(
                          'grid grid-cols-3 gap-1 sm:grid-cols-6 sm:gap-1.5',
                          showTasksCard ? 'mt-2 sm:mt-3' : '',
                        )}
                      >
                        {taskPins.map((id) => {
                          const def = ADMIN_HOME_PINS.find((p) => p.id === id)!;
                          return (
                            <TaskChip
                              key={id}
                              href={def.href}
                              label={def.shortLabel ?? def.label}
                              value={pinCount(id, tasks)}
                            />
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {metricCount > 0 ? (
              <div className={metricsClass}>
                {showWidget('needsReview') ? (
                  <Link
                    href={reviewHref}
                    className="card !p-2.5 block transition hover:border-fitgo-500/40 sm:!p-3.5"
                  >
                    <div className="mb-1 flex items-center gap-1.5">
                      <ClipboardCheck className="h-3.5 w-3.5 text-fitgo-400 sm:h-4 sm:w-4" />
                      <p className="stat-label text-[11px] sm:text-xs">
                        Контроль записей
                      </p>
                    </div>
                    <p className="stat-value text-lg sm:text-2xl">
                      {data.stats.needsReviewCount}
                    </p>
                    <p className="mt-0.5 text-[10px] text-slate-500 sm:text-[11px]">
                      На проверке →
                    </p>
                  </Link>
                ) : null}

                {showWidget('expiringSoon') ? (
                  <Link
                    href="/admin/tasks?topic=membership"
                    className="card !p-2.5 block transition hover:border-amber-500/40 sm:!p-3.5"
                  >
                    <div className="mb-1 flex items-center gap-1.5">
                      <Bell className="h-3.5 w-3.5 text-amber-400 sm:h-4 sm:w-4" />
                      <p className="stat-label text-[11px] sm:text-xs">
                        Истекают скоро
                      </p>
                    </div>
                    <p className="stat-value text-lg sm:text-2xl">
                      {data.stats.expiringSoon}
                    </p>
                    <p className="mt-0.5 text-[10px] text-slate-500 sm:text-[11px]">
                      7 дней →
                    </p>
                  </Link>
                ) : null}

                {showWidget('sessionsToday') ? (
                  <div className="card !p-2.5 sm:!p-3.5">
                    <div className="mb-1 flex items-center gap-1.5">
                      <CalendarCheck className="h-3.5 w-3.5 text-fitgo-400 sm:h-4 sm:w-4" />
                      <p className="stat-label text-[11px] sm:text-xs">
                        Занятий сегодня
                      </p>
                    </div>
                    <Link
                      href={`/admin/booking-control?from=${today}&to=${today}`}
                      className="stat-value text-lg hover:text-fitgo-300 sm:text-2xl"
                    >
                      {data.stats.sessionsToday.total}
                    </Link>
                    <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-slate-400 sm:mt-2 sm:text-[11px]">
                      <Link
                        href={`/admin/booking-control?kind=GROUP&from=${today}&to=${today}`}
                        className="rounded-md px-1 py-0.5 hover:bg-slate-800 hover:text-white"
                      >
                        ГП{' '}
                        <span className="font-medium text-slate-200">
                          {data.stats.sessionsToday.group}
                        </span>
                      </Link>
                      <Link
                        href={`/admin/booking-control?kind=SPA&from=${today}&to=${today}`}
                        className="rounded-md px-1 py-0.5 hover:bg-slate-800 hover:text-white"
                      >
                        SPA{' '}
                        <span className="font-medium text-slate-200">
                          {data.stats.sessionsToday.spa}
                        </span>
                      </Link>
                      <Link
                        href={`/admin/booking-control?kind=PT&from=${today}&to=${today}`}
                        className="rounded-md px-1 py-0.5 hover:bg-slate-800 hover:text-white"
                      >
                        ПТ{' '}
                        <span className="font-medium text-slate-200">
                          {data.stats.sessionsToday.pt}
                        </span>
                      </Link>
                    </div>
                  </div>
                ) : null}

                {showWidget('revenueToday') ? (
                  <div className="card !p-2.5 sm:!p-3.5">
                    <div className="mb-1 flex items-center gap-1.5">
                      <Wallet className="h-3.5 w-3.5 text-fitgo-400 sm:h-4 sm:w-4" />
                      <p className="stat-label text-[11px] sm:text-xs">
                        Выручка сегодня
                      </p>
                    </div>
                    <p className="stat-value text-lg sm:text-2xl">
                      {money(data.stats.revenueToday.total, currency)}
                    </p>
                    <p className="mt-1 text-[10px] leading-snug text-slate-400 sm:mt-1.5 sm:text-[11px]">
                      Нал {money(data.stats.revenueToday.cash, currency)}
                      <span className="text-slate-600"> · </span>
                      Карта {money(data.stats.revenueToday.card, currency)}
                      {data.stats.revenueToday.other > 0 ? (
                        <>
                          <span className="text-slate-600"> · </span>
                          Проч. {money(data.stats.revenueToday.other, currency)}
                        </>
                      ) : null}
                    </p>
                    {revenueSynced ? (
                      <p className="mt-1 text-[10px] text-slate-500">
                        {revenueSynced}
                      </p>
                    ) : (
                      <p className="mt-1 text-[10px] text-slate-500">
                        синхронизация…
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            {showPendingCrm ? (
              <Link
                href="/admin/pending-crm"
                className="card block border border-amber-500/30 bg-amber-500/5 !p-3"
              >
                <p className="font-semibold text-amber-200">
                  Без 1С: {data.stats.pendingCrmCount}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  Клиенты FitGO без карточки CRM — открыть очередь →
                </p>
              </Link>
            ) : null}
          </div>
        ) : null}

        {hasRight ? (
          <div
            className={cn(
              'space-y-2 sm:space-y-3',
              !hasLeft ? 'lg:max-w-md' : '',
            )}
          >
            <div className="card !p-3 sm:!p-4">
              <div className="mb-2 flex items-center justify-between gap-2 sm:mb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400 sm:h-5 sm:w-5" />
                  <h2 className="text-sm font-semibold sm:text-base">
                    Позвонить сегодня
                  </h2>
                </div>
                <Link
                  href="/admin/tasks?topic=membership"
                  className="text-xs text-fitgo-400 hover:underline sm:text-sm"
                >
                  Все
                </Link>
              </div>
              {data.callToday.length === 0 ? (
                <p className="text-sm text-slate-400">Нет звонков на сегодня</p>
              ) : (
                <ul className="divide-y divide-slate-800">
                  {callPreview.map((item) => (
                    <li key={item.taskId}>
                      <Link
                        href={`/admin/tasks?topic=membership&task=${item.taskId}`}
                        className="flex items-center justify-between gap-2 py-2 text-sm transition hover:text-fitgo-300 sm:py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {item.clientName}
                          </p>
                          <p className="truncate text-slate-400">
                            {item.membership}
                            {item.phone ? ` · ${item.phone}` : ''}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-amber-400">{item.daysLeft} дн.</p>
                          <p className="text-slate-500">
                            {formatDate(item.validUntil)}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {callExtra > 0 ? (
                <Link
                  href="/admin/tasks?topic=membership"
                  className="mt-2 block text-center text-xs text-fitgo-400 hover:underline"
                >
                  ещё {callExtra} →
                </Link>
              ) : null}
            </div>

            {navUnderCall ? (
              <div className="flex flex-wrap gap-2">
                {navPins.map((id, i) => {
                  const def = ADMIN_HOME_PINS.find((p) => p.id === id)!;
                  return (
                    <NavPinButton
                      key={id}
                      href={def.href}
                      label={def.label}
                      primary={i === navPins.length - 1}
                    />
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {navFullWidth ? (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-start">
          {navPins.map((id, i) => {
            const def = ADMIN_HOME_PINS.find((p) => p.id === id)!;
            return (
              <NavPinButton
                key={id}
                href={def.href}
                label={def.label}
                primary={i === 0 && navPins.length === 1}
                stretch
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
