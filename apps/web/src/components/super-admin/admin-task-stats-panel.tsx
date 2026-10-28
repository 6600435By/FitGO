'use client';

import type {
  AdminTaskWorkPersonRow,
  AdminTaskWorkReport,
  AdminTaskWorkTopic,
  AnalyticMetric,
} from '@fitgo/shared-types';
import Link from 'next/link';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { MetricCard } from '@/components/analytics/metric-card';
import { DateField } from '@/components/ui/date-field';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthBounds(ref = new Date()) {
  const from = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const to = new Date();
  return { from: isoDate(from), to: isoDate(to) };
}

function snapshotMetric(value: number): AnalyticMetric {
  return {
    value,
    compareValue: null,
    deltaPct: null,
    unit: 'count',
  };
}

function topicHref(topic: AdminTaskWorkTopic) {
  return `/super-admin/tasks?tab=work&topic=${topic}`;
}

function statusLabel(status: string) {
  if (status === 'DONE') return 'Закрыта';
  if (status === 'IN_PROGRESS') return 'В работе';
  if (status === 'OPEN') return 'Открыта';
  if (status === 'CANCELLED') return 'Отменена';
  return status;
}

function PersonDetail({ row }: { row: AdminTaskWorkPersonRow }) {
  return (
    <div className="space-y-3 border-t border-slate-700/60 bg-slate-900/40 px-3 py-3 text-sm">
      <div>
        <p className="mb-1 font-medium text-slate-300">Сейчас открытые</p>
        {row.openTasks.length === 0 ? (
          <p className="text-slate-500">Нет</p>
        ) : (
          <ul className="space-y-1">
            {row.openTasks.map((t) => (
              <li key={t.id} className="flex flex-wrap gap-x-2 text-slate-300">
                <span className={t.overdue ? 'text-rose-400' : ''}>
                  {t.title}
                </span>
                <span className="text-slate-500">
                  {statusLabel(t.status)}
                  {t.dueAt ? ` · до ${formatDateTime(t.dueAt)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-1 font-medium text-slate-300">Закрытые за период</p>
        {row.closedTasks.length === 0 ? (
          <p className="text-slate-500">Нет</p>
        ) : (
          <ul className="space-y-1">
            {row.closedTasks.map((t) => (
              <li key={t.id} className="flex flex-wrap gap-x-2 text-slate-300">
                <span>{t.title}</span>
                <span className="text-slate-500">
                  {t.completedAt
                    ? formatDateTime(t.completedAt)
                    : statusLabel(t.status)}
                  {t.overdue ? ' · с просрочкой' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function AdminTaskStatsPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const defaults = useMemo(() => monthBounds(), []);
  const from = searchParams.get('from') || defaults.from;
  const to = searchParams.get('to') || defaults.to;

  const [report, setReport] = useState<AdminTaskWorkReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const setParams = useCallback(
    (patch: Record<string, string>) => {
      // Live bar — React searchParams lags the previous replace.
      const next = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(patch)) {
        next.set(k, v);
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [pathname, router],
  );

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .analyticsTasks(token, { from, to })
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Ошибка загрузки');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const setPreset = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    setParams({ from: isoDate(start), to: isoDate(end) });
  };

  const setThisMonth = () => {
    const b = monthBounds();
    setParams({ from: b.from, to: b.to });
  };

  const setToday = () => {
    const d = isoDate(new Date());
    setParams({ from: d, to: d });
  };

  const onExport = async () => {
    const token = getToken();
    if (!token) return;
    setExporting(true);
    try {
      const blob = await api.analyticsTasksXlsx(token, { from, to });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `analytics_tasks_${from}_${to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка Excel');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3">
        <DateField
          label="С"
          value={from}
          onChange={(v) => setParams({ from: v })}
        />
        <DateField
          label="По"
          value={to}
          onChange={(v) => setParams({ to: v })}
        />
        <div className="flex flex-wrap gap-1">
          <button type="button" className="btn-secondary text-xs" onClick={setToday}>
            Сегодня
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setPreset(7)}
          >
            7 дней
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={setThisMonth}
          >
            Этот месяц
          </button>
        </div>
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={exporting || loading}
          onClick={() => void onExport()}
        >
          {exporting ? 'Excel…' : 'Excel'}
        </button>
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}
      {loading && !report && <p className="text-slate-400">Загрузка…</p>}

      {report && (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-300">Сейчас</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="В работе" metric={snapshotMetric(report.snapshot.open)} />
              <MetricCard
                label="Просрочено"
                metric={snapshotMetric(report.snapshot.overdue)}
              />
              <MetricCard
                label="Без исполнителя"
                metric={snapshotMetric(report.snapshot.unassigned)}
              />
              <div className="card text-sm">
                <p className="stat-label mb-2">Возраст очереди</p>
                <ul className="space-y-1 text-slate-300">
                  <li>0–1 дн.: {report.snapshot.age.d0_1}</li>
                  <li>2–3 дн.: {report.snapshot.age.d2_3}</li>
                  <li>4–7 дн.: {report.snapshot.age.d4_7}</li>
                  <li>8+ дн.: {report.snapshot.age.d8plus}</li>
                </ul>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-300">За период</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="Создано" metric={report.flow.created} />
              <MetricCard label="Закрыто" metric={report.flow.closed} />
              <MetricCard label="В срок %" metric={report.flow.onTimePct} />
              <MetricCard
                label="Медиана часов до закрытия"
                metric={report.flow.medianCloseHours}
              />
            </div>
          </section>

          <section className="card space-y-2">
            <h2 className="font-semibold">По видам</h2>
            <div className="space-y-2 md:hidden">
              {report.byTopic.map((row) => (
                <Link
                  key={row.topic}
                  href={topicHref(row.topic)}
                  className="block rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2"
                >
                  <p className="font-medium text-fitgo-400">{row.label}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    созд. {row.created} · закр. {row.closed} · в раб.{' '}
                    {row.open}
                    {row.overdue > 0 ? (
                      <span className="text-rose-400">
                        {' '}
                        · проср. {row.overdue}
                      </span>
                    ) : null}
                    {row.onTimePct != null ? ` · в срок ${row.onTimePct}%` : ''}
                  </p>
                </Link>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400">
                    <th className="py-2 pr-2 font-medium">Вид</th>
                    <th className="py-2 pr-2 font-medium">Создано</th>
                    <th className="py-2 pr-2 font-medium">Закрыто</th>
                    <th className="py-2 pr-2 font-medium">В работе</th>
                    <th className="py-2 pr-2 font-medium">Просрочено</th>
                    <th className="py-2 font-medium">В срок %</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byTopic.map((row) => (
                    <tr
                      key={row.topic}
                      className="border-b border-slate-800/80 hover:bg-slate-800/30"
                    >
                      <td className="py-2 pr-2">
                        <Link
                          href={topicHref(row.topic)}
                          className="text-fitgo-400 hover:underline"
                        >
                          {row.label}
                        </Link>
                      </td>
                      <td className="py-2 pr-2">{row.created}</td>
                      <td className="py-2 pr-2">{row.closed}</td>
                      <td className="py-2 pr-2">{row.open}</td>
                      <td className="py-2 pr-2">
                        <span className={row.overdue > 0 ? 'text-rose-400' : ''}>
                          {row.overdue}
                        </span>
                      </td>
                      <td className="py-2">
                        {row.onTimePct == null ? '—' : `${row.onTimePct}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>


          <section className="card space-y-2 overflow-x-auto">
            <h2 className="font-semibold">Матрица: человек × вид</h2>
            <p className="text-xs text-slate-500">
              Клик по ячейке открывает «В работе» с фильтром.
            </p>
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400">
                  <th className="py-2 pr-2 font-medium">Админ</th>
                  <th className="py-2 pr-2 font-medium">Вид</th>
                  <th className="py-2 pr-2 font-medium">Закрыто</th>
                  <th className="py-2 pr-2 font-medium">В срок %</th>
                  <th className="py-2 pr-2 font-medium">Мед. ч</th>
                  <th className="py-2 font-medium">Дораб. %</th>
                </tr>
              </thead>
              <tbody>
                {(report.matrix ?? []).map((cell) => {
                  const person = report.byPerson.find(
                    (p) => p.userId === cell.userId,
                  );
                  const topicRow = report.byTopic.find(
                    (t) => t.topic === cell.topic,
                  );
                  return (
                    <tr
                      key={`${cell.userId}-${cell.topic}`}
                      className="border-b border-slate-800/80 hover:bg-slate-800/30"
                    >
                      <td className="py-2 pr-2">
                        <Link
                          href={`/super-admin/tasks?tab=work&assigneeId=${cell.userId}&topic=${cell.topic}`}
                          className="text-fitgo-400 hover:underline"
                        >
                          {person?.name ?? cell.userId}
                        </Link>
                      </td>
                      <td className="py-2 pr-2">{topicRow?.label ?? cell.topic}</td>
                      <td className="py-2 pr-2">{cell.closed}</td>
                      <td className="py-2 pr-2">
                        {cell.onTimePct == null ? '—' : `${cell.onTimePct}%`}
                      </td>
                      <td className="py-2 pr-2">
                        {cell.medianCloseHours ?? '—'}
                      </td>
                      <td className="py-2">
                        {cell.reworkPct == null ? '—' : `${cell.reworkPct}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(report.matrix ?? []).length === 0 && (
              <p className="text-slate-500">Нет закрытий за период</p>
            )}
          </section>

          <section className="card space-y-2 overflow-x-auto">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">По людям</h2>
              <p className="text-[11px] text-slate-500">{report.ratingFormula}</p>
            </div>
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400">
                  <th className="py-2 pr-2 font-medium">#</th>
                  <th className="py-2 pr-2 font-medium">Админ</th>
                  <th className="py-2 pr-2 font-medium">В работе</th>
                  <th className="py-2 pr-2 font-medium">Просроч.</th>
                  <th className="py-2 pr-2 font-medium">Закрыто</th>
                  <th className="py-2 pr-2 font-medium">В срок %</th>
                  <th className="py-2 pr-2 font-medium">Мед. ч</th>
                  <th className="py-2 pr-2 font-medium">До взят.</th>
                  <th className="py-2 pr-2 font-medium">Дораб. %</th>
                  <th className="py-2 pr-2 font-medium">Снято</th>
                  <th className="py-2 pr-2 font-medium">Продлил</th>
                  <th className="py-2 pr-2 font-medium">Потерял</th>
                  <th className="py-2 font-medium">Рейтинг</th>
                </tr>
              </thead>
              <tbody>
                {report.unassigned.openNow > 0 && (
                  <tr className="border-b border-slate-800/80 bg-slate-800/20">
                    <td className="py-2 pr-2 text-slate-500">—</td>
                    <td className="py-2 pr-2 text-slate-300">Очередь</td>
                    <td className="py-2 pr-2">{report.unassigned.openNow}</td>
                    <td className="py-2 pr-2 text-rose-400">
                      {report.unassigned.overdueNow}
                    </td>
                    <td className="py-2 pr-2 text-slate-500" colSpan={9}>
                      без исполнителя
                    </td>
                  </tr>
                )}
                {report.byPerson.map((row) => {
                  const open = expandedId === row.userId;
                  return (
                    <Fragment key={row.userId}>
                      <tr
                        className="cursor-pointer border-b border-slate-800/80 hover:bg-slate-800/30"
                        onClick={() =>
                          setExpandedId(open ? null : row.userId)
                        }
                      >
                        <td className="py-2 pr-2 text-slate-500">
                          {row.rank ?? '—'}
                        </td>
                        <td className="py-2 pr-2 font-medium">{row.name}</td>
                        <td className="py-2 pr-2">{row.openNow}</td>
                        <td
                          className={`py-2 pr-2 ${row.overdueNow > 0 ? 'text-rose-400' : ''}`}
                        >
                          {row.overdueNow}
                        </td>
                        <td className="py-2 pr-2">{row.closed}</td>
                        <td className="py-2 pr-2">
                          {row.onTimePct == null ? '—' : `${row.onTimePct}%`}
                        </td>
                        <td className="py-2 pr-2">
                          {row.medianCloseHours ?? '—'}
                        </td>
                        <td className="py-2 pr-2">
                          {row.medianClaimHours ?? '—'}
                        </td>
                        <td className="py-2 pr-2">
                          {row.reworkPct == null ? '—' : `${row.reworkPct}%`}
                        </td>
                        <td className="py-2 pr-2">{row.cancelled}</td>
                        <td className="py-2 pr-2">{row.renewalRenewed}</td>
                        <td className="py-2 pr-2">{row.renewalLost}</td>
                        <td className="py-2">
                          {row.rating == null ? (
                            <span className="text-slate-500">мало данных</span>
                          ) : (
                            row.rating
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={13} className="p-0">
                            <PersonDetail row={row} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {report.byPerson.length === 0 && (
              <p className="text-slate-500">Нет админов в клубе</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

