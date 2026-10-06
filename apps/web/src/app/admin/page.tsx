'use client';

import {
  AlertTriangle,
  Bell,
  CalendarCheck,
  ClipboardCheck,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MessagesHomeLink } from '@/components/messages-home-link';
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

  return (
    <div className="space-y-4">
      {data.club && (
        <p className="text-sm text-slate-400">
          Клуб <span className="font-medium text-white">{data.club.name}</span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Link href={reviewHref} className="card block transition hover:border-fitgo-500/40">
          <ClipboardCheck className="mb-2 h-5 w-5 text-fitgo-400" />
          <p className="stat-value">{data.stats.needsReviewCount}</p>
          <p className="stat-label">Контроль записей</p>
          <p className="mt-1 text-xs text-slate-500">На проверке →</p>
        </Link>

        <Link
          href="/admin/tasks?topic=membership"
          className="card block transition hover:border-amber-500/40"
        >
          <Bell className="mb-2 h-5 w-5 text-amber-400" />
          <p className="stat-value">{data.stats.expiringSoon}</p>
          <p className="stat-label">Истекают скоро</p>
          <p className="mt-1 text-xs text-slate-500">7 дней · задачи →</p>
        </Link>

        <div className="card">
          <CalendarCheck className="mb-2 h-5 w-5 text-fitgo-400" />
          <p className="stat-value">{data.stats.sessionsToday.total}</p>
          <p className="stat-label">Занятий сегодня</p>
          <div className="mt-2 space-y-0.5">
            <Link
              href={`/admin/schedule?types=GROUP&date=${today}`}
              className="flex min-h-11 items-center justify-between rounded-lg px-1 text-sm text-slate-300 hover:bg-slate-800/60"
            >
              <span>ГП</span>
              <span className="text-white">
                {data.stats.sessionsToday.group} ›
              </span>
            </Link>
            <Link
              href={`/admin/schedule?types=SPA&date=${today}`}
              className="flex min-h-11 items-center justify-between rounded-lg px-1 text-sm text-slate-300 hover:bg-slate-800/60"
            >
              <span>СПА</span>
              <span className="text-white">
                {data.stats.sessionsToday.spa} ›
              </span>
            </Link>
            <Link
              href={`/admin/schedule?types=PT&date=${today}`}
              className="flex min-h-11 items-center justify-between rounded-lg px-1 text-sm text-slate-300 hover:bg-slate-800/60"
            >
              <span>ПТ</span>
              <span className="text-white">
                {data.stats.sessionsToday.pt} ›
              </span>
            </Link>
          </div>
        </div>

        <div className="card">
          <Wallet className="mb-2 h-5 w-5 text-fitgo-400" />
          <p className="stat-value">
            {money(data.stats.revenueToday.total, currency)}
          </p>
          <p className="stat-label">Выручка сегодня</p>
          <div className="mt-2 space-y-1 text-sm text-slate-300">
            <div className="flex justify-between">
              <span>Наличные</span>
              <span className="text-white">
                {money(data.stats.revenueToday.cash, currency)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Карта</span>
              <span className="text-white">
                {money(data.stats.revenueToday.card, currency)}
              </span>
            </div>
            {data.stats.revenueToday.other > 0 ? (
              <div className="flex justify-between text-slate-400">
                <span>Прочее</span>
                <span>{money(data.stats.revenueToday.other, currency)}</span>
              </div>
            ) : null}
            {revenueSynced ? (
              <p className="pt-1 text-xs text-slate-500">{revenueSynced}</p>
            ) : (
              <p className="pt-1 text-xs text-slate-500">синхронизация в фоне…</p>
            )}
          </div>
        </div>
      </div>

      {(data.stats.pendingCrmCount ?? 0) > 0 && (
        <Link
          href="/admin/pending-crm"
          className="card block border border-amber-500/30 bg-amber-500/5"
        >
          <p className="font-semibold text-amber-200">
            Без 1С: {data.stats.pendingCrmCount}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            Клиенты FitGO без карточки CRM — открыть очередь →
          </p>
        </Link>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <div className="card md:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              <h2 className="font-semibold">Позвонить сегодня</h2>
            </div>
            <Link
              href="/admin/tasks?topic=membership"
              className="text-sm text-fitgo-400 hover:underline"
            >
              Все
            </Link>
          </div>
          {data.callToday.length === 0 ? (
            <p className="text-sm text-slate-400">Нет звонков на сегодня</p>
          ) : (
            <ul className="space-y-2">
              {data.callToday.map((item) => (
                <li key={item.taskId}>
                  <Link
                    href={`/admin/tasks?topic=membership&task=${item.taskId}`}
                    className="flex items-center justify-between rounded-xl bg-slate-800/50 px-3 py-2 text-sm transition hover:bg-slate-800"
                  >
                    <div>
                      <p className="font-medium">{item.clientName}</p>
                      <p className="text-slate-400">
                        {item.membership}
                        {item.phone ? ` · ${item.phone}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
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
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-1">
          <Link href="/admin/at-risk" className="btn-secondary text-center">
            Клиенты в зоне риска
          </Link>
          <Link href="/admin/reports" className="btn-primary text-center">
            Дневной отчёт
          </Link>
          <div className="col-span-2 md:col-span-1">
            <MessagesHomeLink href="/admin/notifications" />
          </div>
        </div>
      </div>
    </div>
  );
}
