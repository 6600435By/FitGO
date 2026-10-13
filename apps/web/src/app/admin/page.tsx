'use client';

import {
  AlertTriangle,
  Bell,
  CalendarCheck,
  ClipboardCheck,
  ListTodo,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, type AdminDashboard } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDate } from '@/lib/utils';

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

function emptyTasks() {
  return {
    total: 0,
    bookingControl: 0,
    membership: 0,
    group: 0,
    spa: 0,
    pt: 0,
    manager: 0,
  };
}

export default function AdminHomePage() {
  const [data, setData] = useState<AdminDashboard | null>(dashboardCache);
  const [error, setError] = useState('');

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
  }, []);

  if (error) return <p className="text-red-400">{error}</p>;

  if (!data) {
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
  const tasks = data.stats.tasks ?? emptyTasks();

  const callPreview = data.callToday.slice(0, 2);
  const callExtra = Math.max(0, data.callToday.length - callPreview.length);

  return (
    <div className="mx-auto max-w-6xl space-y-2 sm:space-y-4">
      {data.club && (
        <p className="text-xs text-slate-400 sm:text-sm">
          Клуб <span className="font-medium text-white">{data.club.name}</span>
        </p>
      )}

      <div className="grid gap-2 sm:gap-4 lg:grid-cols-3">
        <div className="space-y-2 sm:space-y-3 lg:col-span-2">
          <div className="card !p-3 sm:!p-4">
            <div className="flex items-start gap-2 sm:gap-3">
              <ListTodo className="mt-0.5 h-4 w-4 shrink-0 text-fitgo-400 sm:h-5 sm:w-5" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="stat-label">Задачи</p>
                    <Link
                      href="/admin/tasks"
                      className="stat-value text-2xl leading-none hover:text-fitgo-300 sm:text-3xl"
                    >
                      {tasks.total}
                    </Link>
                  </div>
                  <Link
                    href="/admin/tasks"
                    className="text-xs text-slate-500 hover:text-fitgo-400"
                  >
                    Все задачи →
                  </Link>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 sm:mt-3 sm:grid-cols-6 sm:gap-1.5">
                  <TaskChip
                    href="/admin/tasks"
                    label="Контроль"
                    value={tasks.bookingControl}
                  />
                  <TaskChip
                    href="/admin/tasks?topic=membership"
                    label="Абон."
                    value={tasks.membership}
                  />
                  <TaskChip
                    href="/admin/tasks?topic=group_approval"
                    label="ГП"
                    value={tasks.group}
                  />
                  <TaskChip
                    href="/admin/tasks?topic=spa_approval"
                    label="SPA"
                    value={tasks.spa}
                  />
                  <TaskChip
                    href="/admin/tasks?topic=pt_approval"
                    label="ПТ"
                    value={tasks.pt}
                  />
                  <TaskChip
                    href="/admin/tasks?topic=manager"
                    label="Рук."
                    value={tasks.manager}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
            <Link
              href={reviewHref}
              className="card !p-2.5 block transition hover:border-fitgo-500/40 sm:!p-3.5"
            >
              <div className="mb-1 flex items-center gap-1.5">
                <ClipboardCheck className="h-3.5 w-3.5 text-fitgo-400 sm:h-4 sm:w-4" />
                <p className="stat-label text-[11px] sm:text-xs">Контроль записей</p>
              </div>
              <p className="stat-value text-lg sm:text-2xl">
                {data.stats.needsReviewCount}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500 sm:text-[11px]">
                На проверке →
              </p>
            </Link>

            <Link
              href="/admin/tasks?topic=membership"
              className="card !p-2.5 block transition hover:border-amber-500/40 sm:!p-3.5"
            >
              <div className="mb-1 flex items-center gap-1.5">
                <Bell className="h-3.5 w-3.5 text-amber-400 sm:h-4 sm:w-4" />
                <p className="stat-label text-[11px] sm:text-xs">Истекают скоро</p>
              </div>
              <p className="stat-value text-lg sm:text-2xl">
                {data.stats.expiringSoon}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500 sm:text-[11px]">
                7 дней →
              </p>
            </Link>

            <div className="card !p-2.5 sm:!p-3.5">
              <div className="mb-1 flex items-center gap-1.5">
                <CalendarCheck className="h-3.5 w-3.5 text-fitgo-400 sm:h-4 sm:w-4" />
                <p className="stat-label text-[11px] sm:text-xs">Занятий сегодня</p>
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

            <div className="card !p-2.5 sm:!p-3.5">
              <div className="mb-1 flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5 text-fitgo-400 sm:h-4 sm:w-4" />
                <p className="stat-label text-[11px] sm:text-xs">Выручка сегодня</p>
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
                <p className="mt-1 text-[10px] text-slate-500">{revenueSynced}</p>
              ) : (
                <p className="mt-1 text-[10px] text-slate-500">
                  синхронизация…
                </p>
              )}
            </div>
          </div>

          {(data.stats.pendingCrmCount ?? 0) > 0 && (
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
          )}
        </div>

        <div className="space-y-2 sm:space-y-3">
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
                        <p className="truncate font-medium">{item.clientName}</p>
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

          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/at-risk"
              className="btn-secondary flex-1 !px-3 !py-2 text-center text-sm sm:flex-none"
            >
              Зона риска
            </Link>
            <Link
              href="/admin/reports"
              className="btn-primary flex-1 !px-3 !py-2 text-center text-sm sm:flex-none"
            >
              Отчёт
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
