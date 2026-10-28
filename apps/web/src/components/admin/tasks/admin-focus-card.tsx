'use client';

import type {
  AdminInboxItem,
  AdminTasksInboxResponse,
} from '@fitgo/shared-types';
import { ListTodo } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { phoneTelHref } from '@/lib/phone';
import { filterAdminInboxItems } from '@fitgo/shared-types';

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
    return `/admin/tasks?view=now&kind=calls&topic=membership&task=${item.id}`;
  }
  if (item.virtual && item.pending?.sessionKey) {
    return `/admin/tasks?view=now&kind=control&task=${encodeURIComponent(item.id)}`;
  }
  return `/admin/tasks?view=now&task=${item.id}`;
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
  const preview = inbox
    ? filterAdminInboxItems(inbox.items, { view: 'now' }).slice(0, 3)
    : [];

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

          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
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
                const tel =
                  item.primaryAction === 'call'
                    ? phoneTelHref(item.phone)
                    : undefined;
                return (
                  <li key={item.id}>
                    <div className="flex items-center justify-between gap-2 py-2">
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
                      </Link>
                      {tel ? (
                        <a
                          href={tel}
                          className="btn-primary shrink-0 !px-2 !py-1 text-[11px]"
                        >
                          Звонок
                        </a>
                      ) : (
                        <Link
                          href={primaryHref(item)}
                          className="btn-secondary shrink-0 !px-2 !py-1 text-[11px]"
                        >
                          Открыть
                        </Link>
                      )}
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
