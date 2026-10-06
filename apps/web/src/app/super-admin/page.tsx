'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

type Overview = Awaited<ReturnType<typeof api.superAdminOverview>>;

const MIX_COLOR: Record<string, string> = {
  membership: '#34d399',
  training: '#38bdf8',
  spa: '#a78bfa',
  solarium: '#fbbf24',
  shop: '#94a3b8',
  corporate: '#fb7185',
};

function money(minor: number) {
  return (minor / 100).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function shortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function shiftHours(startAt: string, endAt: string) {
  const fmt = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Minsk',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${fmt.format(new Date(startAt))}–${fmt.format(new Date(endAt))}`;
}

function sharePct(share: number) {
  const pct = share * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

function deltaLabel(current: number, previous: number) {
  if (previous === 0) return current === 0 ? '0%' : 'нет базы';
  const pct = Math.round(((current - previous) / previous) * 100);
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

function CompareRow({
  label,
  current,
  previous,
  format,
}: {
  label: string;
  current: number;
  previous: number;
  format: (n: number) => string;
}) {
  const pct = deltaLabel(current, previous);
  const up = previous > 0 && current >= previous;
  return (
    <p className="text-sm text-slate-400">
      {label}:{' '}
      <span className="tabular-nums text-slate-200">{format(previous)}</span>
      <span className={`ml-2 tabular-nums ${up ? 'text-emerald-400' : 'text-rose-300'}`}>
        {pct}
      </span>
    </p>
  );
}

function Donut({
  slices,
}: {
  slices: Array<{ key: string; share: number }>;
}) {
  const positive = slices.filter((s) => s.share > 0);
  let acc = 0;
  const stops =
    positive.length === 0
      ? '#1e293b 0 100%'
      : positive
          .map((s) => {
            const start = acc;
            acc += s.share * 100;
            return `${MIX_COLOR[s.key] ?? '#64748b'} ${start}% ${acc}%`;
          })
          .join(', ');
  return (
    <div className="relative h-40 w-40 shrink-0">
      <div
        className="absolute inset-0 rounded-full"
        style={{ background: `conic-gradient(${stops})` }}
      />
      <div className="absolute inset-[22%] rounded-full bg-slate-950" />
    </div>
  );
}

export default function SuperAdminHomePage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api
      .superAdminOverview(token)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'));
  }, []);

  if (error) return <p className="text-red-400">{error}</p>;
  if (!data) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  const salesHref = `/super-admin/sales?from=${data.revenue.from}&to=${data.revenue.to}`;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Смена на сегодня, выручка и визиты с 1-го числа по {shortDate(data.asOf)}.
      </p>

      <div className="card">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="font-semibold">Сегодня на смене</h2>
          <Link href="/super-admin/staff-roster" className="text-sm text-fitgo-400">
            График
          </Link>
        </div>
        {data.onShift.length === 0 ? (
          <p className="text-sm text-slate-400">В графике на сегодня никого нет</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {data.onShift.map((row) => (
              <li
                key={`${row.userId}-${row.startAt}`}
                className="flex items-baseline justify-between gap-3 py-2 text-sm"
              >
                <span className="font-medium text-white">{row.name}</span>
                <span className="text-right text-slate-400">
                  {row.role}
                  <span className="ml-2 tabular-nums text-slate-500">
                    {shiftHours(row.startAt, row.endAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Link href={salesHref} className="card block transition hover:border-slate-600">
          <p className="text-xs text-slate-500">Выручка за месяц</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-fitgo-300">
            {money(data.revenue.currentMinor)} {data.currency}
          </p>
          <div className="mt-3 space-y-1">
            <CompareRow
              label={`Прошлый месяц на ${shortDate(data.revenue.prevMonthTo)}`}
              current={data.revenue.currentMinor}
              previous={data.revenue.prevMonthMinor}
              format={(n) => `${money(n)} ${data.currency}`}
            />
            <CompareRow
              label={`Год назад на ${shortDate(data.revenue.prevYearTo)}`}
              current={data.revenue.currentMinor}
              previous={data.revenue.prevYearMinor}
              format={(n) => `${money(n)} ${data.currency}`}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">Открыть продажи →</p>
        </Link>

        <div className="card">
          <p className="text-xs text-slate-500">
            Уник. клиенты × дни (зал + ПТ/SPA)
          </p>
          {data.visits.available && data.visits.current != null ? (
            <>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {data.visits.current.toLocaleString('ru-RU')}
              </p>
              <div className="mt-3 space-y-1">
                <CompareRow
                  label={`Прошлый месяц на ${shortDate(data.revenue.prevMonthTo)}`}
                  current={data.visits.current}
                  previous={data.visits.prevMonth ?? 0}
                  format={(n) => n.toLocaleString('ru-RU')}
                />
                <CompareRow
                  label={`Год назад на ${shortDate(data.revenue.prevYearTo)}`}
                  current={data.visits.current}
                  previous={data.visits.prevYear ?? 0}
                  format={(n) => n.toLocaleString('ru-RU')}
                />
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-amber-200/90">
              {data.visits.hint ?? 'Визиты из 1С недоступны'}
            </p>
          )}
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold">Доли в продажах</h2>
        <p className="mb-3 text-xs text-slate-500">
          Сформированные продажи 1С за месяц, корпо — ручные суммы со вкладки продаж
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Donut slices={data.salesMix} />
          <ul className="min-w-0 flex-1 space-y-1.5">
            {data.salesMix.map((slice) => (
              <li key={slice.key} className="flex items-center gap-2 text-sm">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: MIX_COLOR[slice.key] ?? '#64748b' }}
                />
                <span className="flex-1 text-slate-300">{slice.label}</span>
                <span className="tabular-nums text-slate-400">
                  {sharePct(slice.share)}
                </span>
                <span className="w-28 text-right tabular-nums text-white">
                  {money(slice.amountMinor)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <Link href="/super-admin/tasks" className="card block text-sm">
        Открытых задач: <span className="font-semibold text-white">{data.openTasks}</span>
      </Link>
    </div>
  );
}
