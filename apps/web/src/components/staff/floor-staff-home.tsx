'use client';

import type {
  FloorStaffHome,
  FloorStaffHomeSession,
  FloorStaffMonthMetric,
  TrainerMonthAnalytics,
} from '@fitgo/shared-types';
import {
  CalendarCheck,
  ClipboardCheck,
  Clock,
  ListTodo,
  Percent,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { StaffTasksInbox } from '@/components/staff-tasks-inbox';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { cn, formatDateTime } from '@/lib/utils';

type FloorHomeRole = 'specialist' | 'gp';

/** Same window as FloorStaffHomeService pendingMe (past sessions awaiting mark). */
const CONTROL_PENDING_LOOKBACK_DAYS = 45;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

function timeHm(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatDelta(current: number | null, previous: number | null) {
  if (current == null || previous == null) return null;
  if (previous === 0) {
    if (current === 0) return { text: '—', tone: 'flat' as const };
    return { text: 'новый', tone: 'up' as const };
  }
  const pct = Math.round(((current - previous) / previous) * 1000) / 10;
  if (pct === 0) return { text: '0%', tone: 'flat' as const };
  if (pct > 0) return { text: `+${pct}%`, tone: 'up' as const };
  return { text: `${pct}%`, tone: 'down' as const };
}

function DeltaBadge({
  current,
  previous,
}: {
  current: number | null;
  previous: number | null;
}) {
  const delta = formatDelta(current, previous);
  if (!delta) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 font-medium',
        delta.tone === 'up' && 'text-emerald-400/90',
        delta.tone === 'down' && 'text-slate-400',
        delta.tone === 'flat' && 'text-slate-500',
      )}
    >
      {delta.tone === 'up' ? (
        <TrendingUp className="h-3 w-3" />
      ) : delta.tone === 'down' ? (
        <TrendingDown className="h-3 w-3" />
      ) : null}
      {delta.text}
    </span>
  );
}

function MetricCard({ m }: { m: FloorStaffMonthMetric }) {
  const valueText =
    m.value == null
      ? '—'
      : Number.isInteger(m.value)
        ? String(m.value)
        : m.value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
  const prevText =
    m.previous == null
      ? '—'
      : Number.isInteger(m.previous)
        ? String(m.previous)
        : m.previous.toLocaleString('ru-RU', { maximumFractionDigits: 1 });

  return (
    <div className="card !p-3 sm:!p-3.5">
      <p className="stat-label text-xs">{m.label}</p>
      <p className="stat-value text-xl sm:text-2xl">
        {valueText}
        {m.unit && m.value != null ? (
          <span className="ml-1 text-sm font-normal text-slate-500">
            {m.unit}
          </span>
        ) : null}
      </p>
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
        <span>прошл. {prevText}</span>
        <DeltaBadge current={m.value} previous={m.previous} />
      </div>
    </div>
  );
}

function syncLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MonthAnalyticsBlock({
  a,
  controlBase,
  showGroup,
}: {
  a: TrainerMonthAnalytics;
  controlBase: string;
  showGroup: boolean;
}) {
  const range = `from=${encodeURIComponent(a.from)}&to=${encodeURIComponent(a.to)}&conducted=1`;
  const ptHref = `${controlBase}?kind=PT&status=COMPLETED&${range}`;
  const groupHref = `${controlBase}?kind=GROUP&status=COMPLETED&${range}`;
  const giftHref = `${controlBase}?kind=PT&status=COMPLETED&payment=GIFT&${range}`;
  const reformerGroupHref = `${controlBase}?kind=GROUP&status=COMPLETED&hall=REFORMER&${range}`;
  const reformerPersonalHref = `${controlBase}?kind=PT&status=COMPLETED&reformer=personal&${range}`;
  const sync = syncLabel(a.syncedAt);
  const ladderProgress =
    a.ladder && a.ladder.nextMinSessions != null && a.ladder.nextMinSessions > 0
      ? Math.min(
          100,
          Math.round((a.ladder.volumeCount / a.ladder.nextMinSessions) * 100),
        )
      : a.ladder?.isTop
        ? 100
        : 0;

  return (
    <div className="card !p-3.5 space-y-3 sm:!p-4">
      <p className="text-sm font-semibold">
        Месяц{' '}
        <span className="font-normal text-slate-500">
          vs те же дни прошлого
        </span>
      </p>

      <div
        className={cn(
          'grid gap-2',
          showGroup || a.gift.count > 0 ? 'grid-cols-2' : 'grid-cols-1',
        )}
      >
        <Link
          href={ptHref}
          className="rounded-xl border border-slate-800 bg-slate-800/40 px-2.5 py-2 transition hover:border-fitgo-500/40"
        >
          <p className="stat-label text-[11px]">ПТ</p>
          <p className="stat-value text-xl leading-tight">{a.pt.count}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            <DeltaBadge current={a.pt.count} previous={a.pt.previous} />
            {a.pt.gift > 0 ? <span>из них под. {a.pt.gift}</span> : null}
          </div>
        </Link>
        {showGroup ? (
          <Link
            href={groupHref}
            className="rounded-xl border border-slate-800 bg-slate-800/40 px-2.5 py-2 transition hover:border-fitgo-500/40"
          >
            <p className="stat-label text-[11px]">ГП</p>
            <p className="stat-value text-xl leading-tight">{a.group.count}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
              <DeltaBadge
                current={a.group.count}
                previous={a.group.previous}
              />
              {a.group.avgAttendees != null ? (
                <span>явка {a.group.avgAttendees}</span>
              ) : null}
              {a.group.avgFillPct != null ? (
                <span>зап. {a.group.avgFillPct}%</span>
              ) : null}
            </div>
          </Link>
        ) : null}
        {a.gift.count > 0 ? (
          <Link
            href={giftHref}
            className="rounded-xl border border-slate-800 bg-slate-800/40 px-2.5 py-2 transition hover:border-fitgo-500/40"
          >
            <p className="stat-label text-[11px]">Подарочные</p>
            <p className="stat-value text-xl leading-tight">{a.gift.count}</p>
            <div className="mt-0.5 text-[11px] text-slate-500">
              <DeltaBadge current={a.gift.count} previous={a.gift.previous} />
            </div>
          </Link>
        ) : null}
        {a.uniqueClients.total > 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-800/40 px-2.5 py-2">
            <p className="stat-label text-[11px]">Уникальные</p>
            <p className="stat-value text-xl leading-tight">
              {a.uniqueClients.total}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
              <DeltaBadge
                current={a.uniqueClients.total}
                previous={a.uniqueClients.previous}
              />
              {a.uniqueClients.pt > 0 && a.uniqueClients.group > 0 ? (
                <span>
                  ПТ {a.uniqueClients.pt} · ГП {a.uniqueClients.group}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {a.reformer &&
      (a.reformer.group > 0 ||
        a.reformer.personal > 0 ||
        a.reformer.previousGroup > 0 ||
        a.reformer.previousPersonal > 0) ? (
        <div className="grid grid-cols-2 gap-2">
          <Link
            href={reformerGroupHref}
            className="rounded-xl border border-slate-800/80 px-2.5 py-2 text-sm transition hover:border-fitgo-500/40"
          >
            <p className="text-[11px] text-slate-500">Реформер · группы</p>
            <p className="font-semibold text-slate-100">{a.reformer.group}</p>
            <span className="text-[11px] text-slate-500">
              <DeltaBadge
                current={a.reformer.group}
                previous={a.reformer.previousGroup}
              />
            </span>
          </Link>
          <Link
            href={reformerPersonalHref}
            className="rounded-xl border border-slate-800/80 px-2.5 py-2 text-sm transition hover:border-fitgo-500/40"
          >
            <p className="text-[11px] text-slate-500">Реформер · инд.</p>
            <p className="font-semibold text-slate-100">
              {a.reformer.personal}
            </p>
            <span className="text-[11px] text-slate-500">
              <DeltaBadge
                current={a.reformer.personal}
                previous={a.reformer.previousPersonal}
              />
            </span>
          </Link>
        </div>
      ) : null}

      {a.shiftHours != null ? (
        <Link
          href="/trainer/shifts"
          className="flex items-center justify-between rounded-xl border border-slate-800/80 px-2.5 py-2 text-sm transition hover:border-fitgo-500/40"
        >
          <span className="flex items-center gap-1.5 text-slate-400">
            <Clock className="h-3.5 w-3.5" />
            Смены
          </span>
          <span className="flex items-center gap-2 text-[11px] text-slate-500">
            <span className="text-sm font-semibold text-slate-100">
              {a.shiftHours} ч
            </span>
            <DeltaBadge
              current={a.shiftHours}
              previous={a.previousShiftHours}
            />
          </span>
        </Link>
      ) : null}

      {a.giftConversion && a.giftConversion.giftedClients > 0 ? (
        <div className="rounded-xl border border-slate-800/80 px-2.5 py-2">
          <p className="text-[11px] text-slate-500">Подарок → оплата</p>
          <p className="mt-0.5 text-sm font-semibold text-slate-100">
            {a.giftConversion.convertedClients} из{' '}
            {a.giftConversion.giftedClients}
            {a.giftConversion.pct != null
              ? ` · ${a.giftConversion.pct}%`
              : ''}
          </p>
          <div className="mt-0.5 text-[11px] text-slate-500">
            <DeltaBadge
              current={a.giftConversion.pct}
              previous={a.giftConversion.previousPct}
            />
          </div>
        </div>
      ) : null}

      {a.ladder ? (
        <div className="rounded-xl border border-slate-800/80 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <Percent className="h-3.5 w-3.5" />
              Ступень %
            </p>
            <p className="text-sm font-semibold text-fitgo-400">
              {a.ladder.percent}%
            </p>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {a.ladder.isTop
              ? `${a.ladder.percent}% · верхняя ступень · ${a.ladder.volumeCount} в объёме`
              : `ещё ${a.ladder.remaining} до ${a.ladder.nextMinSessions} (${a.ladder.volumeCount} в объёме)`}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-fitgo-500/80"
              style={{ width: `${ladderProgress}%` }}
            />
          </div>
          {a.ladder.volumeCount !== a.pt.count ? (
            <p className="mt-1.5 text-[10px] leading-snug text-slate-600">
              В лестницу не входят AllSports и инд. реформер (при схеме
              реформера).
            </p>
          ) : null}
        </div>
      ) : null}

      {sync ? (
        <p className="text-[10px] text-slate-600">
          по синхронизации занятий · {sync}
        </p>
      ) : null}
    </div>
  );
}

function SessionRow({
  session,
  scheduleHref,
  controlHref,
}: {
  session: FloorStaffHomeSession;
  scheduleHref: string;
  controlHref: (s: FloorStaffHomeSession) => string;
}) {
  const muted = session.status === 'DONE' || session.status === 'CANCELLED';
  const accent = session.status === 'IN_PROGRESS' || session.status === 'UPCOMING';
  const href =
    session.status === 'DONE' && session.sessionKey
      ? controlHref(session)
      : scheduleHref;
  const kindLabel =
    session.kind === 'PT' ? 'ПТ' : session.kind === 'GROUP' ? 'ГП' : null;

  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
        accent
          ? 'bg-fitgo-500/10 ring-1 ring-fitgo-500/30 hover:bg-fitgo-500/15'
          : muted
            ? 'bg-slate-800/30 text-slate-500 hover:bg-slate-800/50'
            : 'bg-slate-800/50 hover:bg-slate-800',
      )}
    >
      <span
        className={cn(
          'w-12 shrink-0 tabular-nums font-medium',
          accent ? 'text-fitgo-300' : muted ? 'text-slate-500' : 'text-slate-200',
        )}
      >
        {timeHm(session.startAt)}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('truncate font-medium', muted && 'text-slate-400')}>
          {kindLabel ? (
            <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {kindLabel}
            </span>
          ) : null}
          {session.title}
        </p>
        {session.subtitle ? (
          <p className="truncate text-xs text-slate-500">{session.subtitle}</p>
        ) : null}
      </div>
      {session.booked != null && session.capacity != null ? (
        <span className="shrink-0 tabular-nums text-xs text-slate-400">
          {session.booked}/{session.capacity}
        </span>
      ) : null}
      {session.status === 'IN_PROGRESS' ? (
        <span className="shrink-0 rounded-md bg-fitgo-500/20 px-1.5 py-0.5 text-[10px] font-medium text-fitgo-300">
          сейчас
        </span>
      ) : null}
    </Link>
  );
}

export function FloorStaffHomePage({
  role,
  scheduleHref,
}: {
  role: FloorHomeRole;
  /** Override schedule deep-link (PT calendar vs club GP schedule). */
  scheduleHref?: string;
}) {
  const [data, setData] = useState<FloorStaffHome | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;
    const req =
      role === 'specialist'
        ? api.specialistHome(token)
        : api.trainerGpHome(token);
    req
      .then(setData)
      .catch((err: Error) => setError(err.message || 'Ошибка загрузки'));
  }, [role]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="text-red-400">{error}</p>;

  if (!data) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  const scheduleBase =
    scheduleHref ??
    (role === 'specialist' ? '/specialist/schedule' : '/trainer/gp-schedule');
  const controlBase =
    role === 'specialist'
      ? '/specialist/my-sessions'
      : '/trainer/my-sessions';
  const showGroupConducted =
    (data.monthAnalytics?.group.count ?? data.conducted?.group ?? 0) > 0 ||
    data.today.sessions.some((s) => s.kind === 'GROUP') ||
    data.month.metrics.some((m) => m.label === 'Средняя явка');
  // pendingMe is counted over ~45 days; control UI defaults to «today» unless
  // from/to are in the URL — without them the widget showed 9 and the list 0.
  const controlFrom = daysAgoIso(CONTROL_PENDING_LOOKBACK_DAYS);
  const controlTo = todayIso();
  const controlPendingQs = `from=${encodeURIComponent(controlFrom)}&to=${encodeURIComponent(controlTo)}&needsReview=1`;
  const reviewHref = `${controlBase}?${controlPendingQs}`;
  const controlSessionHref = (s: FloorStaffHomeSession) =>
    s.sessionKey
      ? `${controlBase}?session=${encodeURIComponent(s.sessionKey)}`
      : controlBase;

  const pending = data.control.pendingMe;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm text-slate-400">Добро пожаловать</p>
          <p className="text-xl font-semibold text-white sm:text-2xl">
            {data.staffName || '—'}
          </p>
        </div>
        <p className="text-xs text-slate-500">
          {new Date(data.today.date + 'T12:00:00').toLocaleDateString('ru-RU', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </p>
      </div>

      <StaffTasksInbox />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="card !p-3.5 sm:!p-4">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div className="flex items-center gap-2">
                <CalendarCheck className="h-5 w-5 text-fitgo-400" />
                <div>
                  <p className="stat-label">Записи на сегодня</p>
                  <p className="stat-value text-3xl leading-none">
                    {data.today.count}
                  </p>
                </div>
              </div>
              <Link
                href={scheduleBase}
                className="text-xs text-slate-500 hover:text-fitgo-400"
              >
                Расписание →
              </Link>
            </div>

            {data.today.next ? (
              <div className="mb-3 rounded-xl border border-fitgo-500/20 bg-fitgo-500/5 px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-fitgo-400/80">
                  Ближайшая
                </p>
                <p className="mt-0.5 font-medium text-white">
                  {timeHm(data.today.next.startAt)} · {data.today.next.title}
                </p>
                {data.today.next.subtitle ? (
                  <p className="text-sm text-slate-400">
                    {data.today.next.subtitle}
                    {data.today.next.booked != null &&
                    data.today.next.capacity != null
                      ? ` · ${data.today.next.booked}/${data.today.next.capacity}`
                      : ''}
                  </p>
                ) : null}
              </div>
            ) : null}

            {data.today.sessions.length === 0 ? (
              <p className="text-sm text-slate-400">
                На сегодня записей нет — можно закрыть контроль или открыть
                расписание.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {data.today.sessions.map((s) => (
                  <li key={s.id}>
                    <SessionRow
                      session={s}
                      scheduleHref={scheduleBase}
                      controlHref={controlSessionHref}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {role === 'specialist' && data.spa ? (
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="card !p-3 sm:!p-3.5">
                <div className="mb-2 flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-fitgo-400" />
                  <p className="stat-label text-xs">Свободные окна</p>
                </div>
                {data.spa.freeWindowsToday.length === 0 ? (
                  <p className="text-sm text-slate-400">Нет свободных окон</p>
                ) : (
                  <ul className="space-y-1.5">
                    {data.spa.freeWindowsToday.map((w) => (
                      <li key={w.startAt}>
                        <Link
                          href={scheduleBase}
                          className="flex items-center justify-between rounded-lg bg-slate-800/50 px-2.5 py-1.5 text-sm hover:bg-slate-800"
                        >
                          <span>
                            {timeHm(w.startAt)}–{timeHm(w.endAt)}
                          </span>
                          <span className="text-xs text-slate-500">
                            {w.minutes} мин
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {data.spa.waitlistCount > 0 ? (
                <Link
                  href={scheduleBase}
                  className="card !p-3 block transition hover:border-fitgo-500/40 sm:!p-3.5"
                >
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-amber-400" />
                    <p className="stat-label text-xs">Лист ожидания</p>
                  </div>
                  <p className="stat-value text-xl sm:text-2xl">
                    {data.spa.waitlistCount}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Открыть расписание →
                  </p>
                </Link>
              ) : (
                <div className="card !p-3 sm:!p-3.5">
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-slate-500" />
                    <p className="stat-label text-xs">Лист ожидания</p>
                  </div>
                  <p className="text-sm text-slate-400">Пусто</p>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="space-y-3">
          <Link
            href={reviewHref}
            className={cn(
              'card !p-3.5 block transition sm:!p-4',
              pending > 0
                ? 'border-amber-500/40 bg-amber-500/5 hover:border-amber-500/60'
                : 'hover:border-fitgo-500/40',
            )}
          >
            <div className="flex items-start gap-3">
              <ClipboardCheck
                className={cn(
                  'mt-0.5 h-5 w-5 shrink-0',
                  pending > 0 ? 'text-amber-400' : 'text-fitgo-400',
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="stat-label">Контроль записей</p>
                <p className="stat-value text-3xl leading-none">{pending}</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {pending > 0
                    ? 'Ждут вашей отметки →'
                    : 'Всё закрыто с вашей стороны'}
                </p>
                {data.control.pendingAdmin > 0 ? (
                  <p className="mt-1 text-[11px] text-slate-500">
                    У администратора: {data.control.pendingAdmin}
                  </p>
                ) : null}
              </div>
            </div>
          </Link>

          {data.control.queue.length > 0 ? (
            <div className="card !p-3 space-y-2 sm:!p-3.5">
              <div className="flex items-center gap-1.5">
                <ListTodo className="h-4 w-4 text-amber-400" />
                <p className="text-xs font-medium text-slate-300">
                  Закрыть сейчас
                </p>
              </div>
              <ul className="space-y-1.5">
                {data.control.queue.map((item) => (
                  <li key={item.sessionKey}>
                    <Link
                      href={`${controlBase}?session=${encodeURIComponent(item.sessionKey)}&${controlPendingQs}`}
                      className="block rounded-lg bg-slate-800/50 px-2.5 py-2 text-sm transition hover:bg-slate-800"
                    >
                      <p className="font-medium">{item.title}</p>
                      <p className="text-xs text-slate-500">
                        {formatDateTime(item.startAt)}
                        {item.subtitle ? ` · ${item.subtitle}` : ''}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.monthAnalytics && role === 'gp' ? (
            <MonthAnalyticsBlock
              a={data.monthAnalytics}
              controlBase={controlBase}
              showGroup={showGroupConducted}
            />
          ) : null}

          {role === 'specialist' && data.month.metrics.length > 0 ? (
            <div className="card !p-3.5 sm:!p-4">
              <p className="mb-3 text-sm font-semibold">
                Месяц{' '}
                <span className="font-normal text-slate-500">
                  vs те же дни прошлого
                </span>
              </p>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
                {data.month.metrics.map((m) => (
                  <MetricCard key={m.label} m={m} />
                ))}
              </div>
              {data.month.footnote ? (
                <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                  {data.month.footnote}
                </p>
              ) : null}
            </div>
          ) : null}

          {data.monthAnalytics &&
          role === 'gp' &&
          data.month.footnote ? (
            <p className="px-0.5 text-[11px] leading-relaxed text-slate-500">
              {data.month.footnote}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
