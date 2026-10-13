'use client';

import type {
  FloorStaffHome,
  FloorStaffHomeSession,
  FloorStaffMonthMetric,
} from '@fitgo/shared-types';
import {
  CalendarCheck,
  ClipboardCheck,
  Clock,
  ListTodo,
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

function MetricCard({ m }: { m: FloorStaffMonthMetric }) {
  const delta = formatDelta(m.value, m.previous);
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
        {delta ? (
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
        ) : null}
      </div>
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

export function FloorStaffHomePage({ role }: { role: FloorHomeRole }) {
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
    role === 'specialist' ? '/specialist/schedule' : '/trainer/gp-schedule';
  const controlBase =
    role === 'specialist'
      ? '/specialist/my-sessions'
      : '/trainer/my-sessions';
  const reviewHref = `${controlBase}?needsReview=1`;
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
                      href={`${controlBase}?session=${encodeURIComponent(item.sessionKey)}&needsReview=1`}
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

          <div className="card !p-3.5 sm:!p-4">
            <p className="mb-3 text-sm font-semibold">
              Месяц{' '}
              <span className="font-normal text-slate-500">
                vs прошлый
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
        </div>
      </div>
    </div>
  );
}
