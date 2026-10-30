'use client';

import type {
  AdminInboxItem,
  AdminTasksInboxResponse,
} from '@fitgo/shared-types';
import {
  filterAdminInboxItems,
  isAdminInboxDebtKind,
  resolveAdminInboxPhone,
} from '@fitgo/shared-types';
import { ListTodo, Phone } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { phoneTelHref } from '@/lib/phone';

function FocusStat({
  href,
  label,
  value,
  warn,
}: {
  href: string;
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-9 flex-col justify-center rounded-xl bg-slate-800/60 px-2 py-1.5 transition hover:bg-slate-800"
    >
      <span className="text-[10px] leading-tight text-slate-500">{label}</span>
      <span
        className={`text-sm font-semibold tabular-nums sm:text-base ${
          warn && value > 0 ? 'text-rose-300' : 'text-white'
        }`}
      >
        {value}
      </span>
    </Link>
  );
}

function primaryHref(item: AdminInboxItem): string {
  if (item.primaryAction === 'open_renewal') {
    return `/admin/tasks?view=now&kind=calls&task=${item.id}`;
  }
  if (item.kind === 'birthday' || item.source === 'BIRTHDAY') {
    return `/admin/tasks?view=now&kind=birthday&task=${item.id}`;
  }
  if (
    item.primaryAction === 'confirm' ||
    item.source === 'BOOKING_CONFIRM' ||
    item.topic === 'confirmation'
  ) {
    return `/admin/tasks?view=now&kind=control&topic=confirmation&task=${item.id}`;
  }
  if (item.kind === 'manager') {
    return `/admin/tasks?view=now&kind=manager&task=${item.id}`;
  }
  if (item.kind === 'money') {
    return `/admin/tasks?view=now&kind=money&task=${item.id}`;
  }
  if (item.kind === 'staff') {
    return `/admin/tasks?view=now&kind=staff&task=${item.id}`;
  }
  if (item.kind === 'calls') {
    return `/admin/tasks?view=now&kind=calls&task=${item.id}`;
  }
  if (item.kind === 'booking' || (item.virtual && item.pending?.sessionKey)) {
    const topic = item.topic ? `&topic=${item.topic}` : '';
    return `/admin/tasks?view=now&kind=booking${topic}&task=${encodeURIComponent(item.id)}`;
  }
  return `/admin/tasks?view=now&task=${item.id}`;
}

function focusCtaLabel(item: AdminInboxItem): string {
  if (item.primaryAction === 'confirm') return 'Подтвердить';
  if (item.primaryAction === 'open_renewal') return 'Воронка';
  if (item.primaryAction === 'call') return 'Открыть';
  if (item.kind === 'money' || item.kind === 'staff') return 'Долг';
  return 'Открыть';
}

export function AdminFocusCard() {
  const [inbox, setInbox] = useState<AdminTasksInboxResponse | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api
      .adminTasksInbox(token)
      .then(setInbox)
      .catch(() => setInbox(null));
  }, []);

  const counts = inbox?.counts;
  const focusItems = inbox
    ? filterAdminInboxItems(inbox.items, { view: 'now' })
    : [];
  const preview = focusItems.slice(0, 3);
  const debtCount = focusItems.filter(isAdminInboxDebtKind).length;

  return (
    <div className="card !p-3 sm:!p-4">
      <div className="flex items-start gap-2 sm:gap-3">
        <ListTodo className="mt-0.5 h-4 w-4 shrink-0 text-fitgo-400 sm:h-5 sm:w-5" />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="stat-label">Мой фокус</p>
              <Link
                href="/admin/tasks?view=now"
                className="stat-value text-2xl leading-none hover:text-fitgo-300 sm:text-3xl"
              >
                {counts?.total ?? '—'}
              </Link>
            </div>
            <Link
              href="/admin/tasks?view=now"
              className="text-xs text-slate-500 hover:text-fitgo-400"
            >
              Очередь →
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
            <FocusStat
              href="/admin/tasks?view=now"
              label="Просрочено"
              value={counts?.overdue ?? 0}
              warn
            />
            <FocusStat
              href="/admin/tasks?view=now"
              label="Сегодня"
              value={counts?.today ?? 0}
            />
            <FocusStat
              href="/admin/tasks?view=now&kind=money"
              label="Долги"
              value={debtCount}
              warn
            />
            <FocusStat
              href="/admin/tasks?view=mine"
              label="Мои"
              value={counts?.mine ?? 0}
            />
            <FocusStat
              href="/admin/tasks?view=now"
              label="Доработка"
              value={counts?.rework ?? 0}
              warn
            />
          </div>

          {preview.length > 0 ? (
            <ul className="divide-y divide-slate-800">
              {preview.map((item) => {
                const phone = resolveAdminInboxPhone(item);
                const multiClient =
                  (item.task?.confirmClients?.length ?? 0) > 1;
                const tel = multiClient ? null : phoneTelHref(phone);
                const cta = focusCtaLabel(item);
                return (
                  <li key={item.id}>
                    <div className="flex items-center gap-2 py-2">
                      <Link
                        href={primaryHref(item)}
                        className="min-w-0 flex-1 transition hover:text-fitgo-300"
                      >
                        <p className="truncate text-sm font-medium">
                          {item.title}
                        </p>
                        {item.subtitle ? (
                          <p className="truncate text-xs text-slate-400">
                            {item.subtitle}
                          </p>
                        ) : null}
                        {phone && !multiClient ? (
                          <p className="mt-0.5 truncate text-[11px] tabular-nums text-slate-500">
                            {phone}
                          </p>
                        ) : null}
                      </Link>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {tel ? (
                          <a
                            href={tel}
                            aria-label={`Позвонить ${phone}`}
                            title="Позвонить"
                            className="btn-primary inline-flex h-8 w-8 items-center justify-center !rounded-full !p-0"
                          >
                            <Phone className="h-3.5 w-3.5" />
                          </a>
                        ) : null}
                        <Link
                          href={primaryHref(item)}
                          className="btn-secondary shrink-0 !px-2.5 !py-1.5 text-[11px]"
                        >
                          {cta}
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">
              {inbox ? 'На сейчас задач нет' : 'Загрузка…'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
