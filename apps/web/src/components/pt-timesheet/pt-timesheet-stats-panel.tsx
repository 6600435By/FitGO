'use client';

import type {
  PtStatsReport,
  PtStatsSessionLine,
  PtStatsTrainerSummary,
} from '@fitgo/shared-types';
import {
  ptStatsOriginLabelRu,
  ptStatsPaymentLabelRu,
} from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateField } from '@/components/ui/date-field';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export type PtTimesheetStatsAudience = 'trainer' | 'admin' | 'super';

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function monthBounds(d = new Date()) {
  const from = new Date(d.getFullYear(), d.getMonth(), 1);
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { from: isoDate(from), to: isoDate(to) };
}

function money(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)}\u00a0${currency}`;
}

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function bookingHref(
  audience: PtTimesheetStatsAudience,
  sessionKey: string,
  day: string,
): string {
  const q = new URLSearchParams({ from: day, to: day });
  if (audience === 'trainer') {
    q.set('session', sessionKey);
    return `/trainer/my-sessions?${q}`;
  }
  q.set('sessionKey', sessionKey);
  if (audience === 'super') {
    return `/super-admin/review-queue?${q}`;
  }
  return `/admin/booking-control?${q}`;
}

function saleHref(
  audience: PtTimesheetStatsAudience,
  line: PtStatsSessionLine,
): string | null {
  if (audience === 'trainer') return null;
  const base = audience === 'super' ? '/super-admin/sales' : '/admin/sales';
  const q = new URLSearchParams();
  const day =
    line.saleOccurredAt?.slice(0, 10) || line.occurredAt.slice(0, 10);
  q.set('from', day);
  q.set('to', day);
  if (line.saleExternalId) q.set('externalId', line.saleExternalId);
  else if (line.clientName) q.set('q', line.clientName);
  else return null;
  return `${base}?${q}`;
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-0.5 text-lg font-semibold text-white">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function summaryCards(
  s: PtStatsTrainerSummary,
  currency: string,
  showShift: boolean,
) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      <StatCard label="Проведено" value={String(s.sessionsConducted)} />
      <StatCard
        label="Неявки / отмены"
        value={`${s.noShowCount} / ${s.cancelledCount}`}
      />
      <StatCard label="Уникальные" value={String(s.uniqueClients)} />
      <StatCard
        label="Новые / повторные"
        value={`${s.newClients} / ${s.returningClients}`}
      />
      <StatCard
        label="На клиента"
        value={s.sessionsPerClient != null ? String(s.sessionsPerClient) : '—'}
      />
      <StatCard
        label="Удержание"
        value={s.retentionPct != null ? `${s.retentionPct}%` : '—'}
        hint="доля клиентов прошлого окна той же длины"
      />
      <StatCard
        label="Удержание 60–90"
        value={s.retention90Pct != null ? `${s.retention90Pct}%` : '—'}
        hint="когорта первого ПТ"
      />
      <StatCard
        label="Конверсия новичков"
        value={s.conversionPct != null ? `${s.conversionPct}%` : '—'}
        hint="оплаченная ПТ за 30 дней"
      />
      <StatCard
        label="Абон / блок / разовая"
        value={`${s.mix.membership} / ${s.mix.block} / ${s.mix.oneShot}`}
        hint={
          s.mix.gift || s.mix.unknown
            ? `подарок ${s.mix.gift}, н/р ${s.mix.unknown}`
            : undefined
        }
      />
      <StatCard
        label="Списано / оплачено / долг"
        value={`${s.payments.writtenOff} / ${s.payments.paid} / ${s.payments.debt}`}
        hint={
          s.payments.debtMinor > 0
            ? `долг ${money(s.payments.debtMinor, currency)}`
            : undefined
        }
      />
      {showShift && (
        <StatCard
          label="Смена"
          value={`${(s.shiftMinutes / 60).toFixed(1)} ч`}
          hint={
            s.hourlyRateMinor > 0
              ? money(s.shiftPayMinor, currency)
              : undefined
          }
        />
      )}
      <StatCard
        label="Начислено"
        value={money(s.totalEarnMinor, currency)}
        hint={
          s.ladderPercent != null
            ? `ПТ ${money(s.sessionMotivationMinor, currency)} · лестница ${s.ladderPercent}%`
            : `ПТ ${money(s.sessionMotivationMinor, currency)}`
        }
      />
    </div>
  );
}

export function PtTimesheetStatsPanel({
  audience,
}: {
  audience: PtTimesheetStatsAudience;
}) {
  const initial = useMemo(() => monthBounds(), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [trainerId, setTrainerId] = useState('');
  const [report, setReport] = useState<PtStatsReport | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const canExport = audience === 'admin' || audience === 'super';
  const showTrainerFilter = audience !== 'trainer';

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setMessage('');
    try {
      // Admin/SA always load all PT trainers; filter is client-side.
      const data =
        audience === 'trainer'
          ? await api.trainerPtStats(token, from, to)
          : audience === 'admin'
            ? await api.adminPtStats(token, from, to)
            : await api.saPtStats(token, from, to);
      setReport(data);
    } catch (e) {
      setReport(null);
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, [audience, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const setPreset = (kind: 'week' | 'month' | 'prevMonth') => {
    const now = new Date();
    if (kind === 'week') {
      const day = now.getDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const mon = new Date(now);
      mon.setDate(now.getDate() + mondayOffset);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      setFrom(isoDate(mon));
      setTo(isoDate(sun));
      return;
    }
    if (kind === 'prevMonth') {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const b = monthBounds(d);
      setFrom(b.from);
      setTo(b.to);
      return;
    }
    const b = monthBounds(now);
    setFrom(b.from);
    setTo(b.to);
  };

  const exportXlsx = async () => {
    const token = getToken();
    if (!token || !canExport) return;
    setExporting(true);
    setMessage('');
    try {
      const tid = trainerId.trim() || undefined;
      // Excel respects current trainer filter when one is selected.
      const blob =
        audience === 'admin'
          ? await api.adminPtStatsXlsx(token, from, to, tid)
          : await api.saPtStatsXlsx(token, from, to, tid);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pt_stats_${from}_${to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка Excel');
    } finally {
      setExporting(false);
    }
  };

  const printTable = () => {
    if (!report) return;
    const w = window.open('', '_blank');
    if (!w) return;
    const currency = report.currency;
    const head =
      audience !== 'trainer'
        ? '<th>Тренер</th>'
        : '';
    const rows = report.lines
      .map((l) => {
        const trainerCell =
          audience !== 'trainer'
            ? `<td>${escapeHtml(l.trainerName)}</td>`
            : '';
        return `<tr>
          <td>${escapeHtml(fmtWhen(l.occurredAt))}</td>
          ${trainerCell}
          <td>${escapeHtml(l.clientName)}</td>
          <td>${escapeHtml(ptStatsOriginLabelRu(l.origin))}</td>
          <td>${escapeHtml(ptStatsPaymentLabelRu(l.payment))}</td>
          <td>${money(l.priceMinor, currency)}</td>
          <td>${l.ratePercent ?? '—'}</td>
          <td>${money(l.earnMinor, currency)}</td>
        </tr>`;
      })
      .join('');
    w.document.write(
      `<!doctype html><html><head><title>Статистика ПТ ${from}—${to}</title>
      <style>body{font-family:system-ui;padding:16px}table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #ccc;padding:4px 6px;font-size:12px;text-align:left}
      h1{font-size:16px}</style></head><body>
      <h1>Статистика ПТ ${from} — ${to}</h1>
      <p>Проведено: ${report.totals.sessionsConducted}, начислено: ${money(report.totals.totalEarnMinor, currency)}</p>
      <table><thead><tr><th>Дата</th>${head}<th>Клиент</th><th>Откуда</th><th>Оплата</th><th>Цена</th><th>%</th><th>Начислено</th></tr></thead>
      <tbody>${rows}</tbody></table></body></html>`,
    );
    w.document.close();
    w.print();
  };

  const linesByClient = useMemo(() => {
    if (!report) return [];
    const map = new Map<string, PtStatsSessionLine[]>();
    for (const l of report.lines) {
      const list = map.get(l.clientKey) ?? [];
      list.push(l);
      map.set(l.clientKey, list);
    }
    return [...map.entries()]
      .map(([key, lines]) => ({
        key,
        name: lines[0]?.clientName ?? key,
        lines: [...lines].sort((a, b) =>
          a.occurredAt.localeCompare(b.occurredAt),
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [report]);

  const focusSummary = useMemo(() => {
    if (!report) return null;
    if (trainerId) {
      return (
        report.trainers.find((t) => t.trainerId === trainerId) ?? report.totals
      );
    }
    return report.totals;
  }, [report, trainerId]);

  const visibleLinesByClient = useMemo(() => {
    if (!trainerId) return linesByClient;
    return linesByClient
      .map((g) => ({
        ...g,
        lines: g.lines.filter((l) => l.trainerId === trainerId),
      }))
      .filter((g) => g.lines.length > 0);
  }, [linesByClient, trainerId]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <DateField label="С" value={from} onChange={setFrom} className="w-36" />
        <DateField label="По" value={to} onChange={setTo} className="w-36" />
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-500"
            onClick={() => setPreset('week')}
          >
            Неделя
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-500"
            onClick={() => setPreset('month')}
          >
            Месяц
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-500"
            onClick={() => setPreset('prevMonth')}
          >
            Прошлый месяц
          </button>
        </div>
        {showTrainerFilter && report && report.trainers.length > 0 && (
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Тренер
            <select
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
              value={trainerId}
              onChange={(e) => setTrainerId(e.target.value)}
            >
              <option value="">Все</option>
              {report.trainers.map((t) => (
                <option key={t.trainerId} value={t.trainerId}>
                  {t.trainerName}
                </option>
              ))}
            </select>
          </label>
        )}
        {canExport && (
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!report || exporting}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-fitgo-500 disabled:opacity-40"
              onClick={() => void exportXlsx()}
            >
              {exporting ? 'Excel…' : 'Excel'}
            </button>
            <button
              type="button"
              disabled={!report}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-fitgo-500 disabled:opacity-40"
              onClick={printTable}
            >
              Печать
            </button>
          </div>
        )}
      </div>

      {message && (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-200">
          {message}
        </p>
      )}

      {loading && (
        <p className="text-sm text-slate-500">Загрузка статистики…</p>
      )}

      {focusSummary && report && (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-slate-300">
              Сводка
              {trainerId
                ? ` · ${focusSummary.trainerName}`
                : report.trainers.length > 1
                  ? ' · все тренеры'
                  : ` · ${focusSummary.trainerName}`}
            </h2>
            <p className="text-xs text-slate-500">
              Начислено = мотивация ПТ + оплата смены. Групповые и % с продаж
              абонементов не входят. % лестницы — по календарному месяцу
              занятия.
            </p>
            {summaryCards(
              focusSummary,
              report.currency,
              report.showShiftColumns,
            )}
          </section>

          {showTrainerFilter &&
            !trainerId &&
            report.trainers.length > 1 && (
              <section className="space-y-2">
                <h2 className="text-sm font-medium text-slate-300">
                  По тренерам
                </h2>
                <div className="overflow-x-auto rounded-xl border border-slate-800">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-slate-800 text-xs text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Тренер</th>
                        <th className="px-3 py-2 font-medium">ПТ</th>
                        <th className="px-3 py-2 font-medium">Клиенты</th>
                        <th className="px-3 py-2 font-medium">Новые</th>
                        <th className="px-3 py-2 font-medium">Удерж.</th>
                        <th className="px-3 py-2 font-medium">Начислено</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.trainers.map((t) => (
                        <tr
                          key={t.trainerId}
                          className="cursor-pointer border-b border-slate-800/80 hover:bg-slate-900/60"
                          onClick={() => setTrainerId(t.trainerId)}
                        >
                          <td className="px-3 py-2 text-white">
                            {t.trainerName}
                          </td>
                          <td className="px-3 py-2 text-slate-300">
                            {t.sessionsConducted}
                          </td>
                          <td className="px-3 py-2 text-slate-300">
                            {t.uniqueClients}
                          </td>
                          <td className="px-3 py-2 text-slate-300">
                            {t.newClients}
                          </td>
                          <td className="px-3 py-2 text-slate-300">
                            {t.retentionPct != null
                              ? `${t.retentionPct}%`
                              : '—'}
                          </td>
                          <td className="px-3 py-2 text-fitgo-300">
                            {money(t.totalEarnMinor, report.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

          {(() => {
            const gaps = report.noNextBooking.filter(
              (g) => !trainerId || g.trainerId === trainerId,
            );
            if (gaps.length === 0) return null;
            return (
              <section className="space-y-2">
                <h2 className="text-sm font-medium text-slate-300">
                  Нет следующей записи ({gaps.length})
                </h2>
                <ul className="space-y-1 text-sm text-slate-400">
                  {gaps.slice(0, 12).map((g) => (
                    <li key={g.clientKey}>
                      <span className="text-white">{g.clientName}</span>
                      {' · '}
                      {fmtWhen(g.lastSessionAt)}
                      {audience !== 'trainer' && (
                        <span className="text-slate-500">
                          {' '}
                          · {g.trainerName}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })()}

          <section className="space-y-3" id="pt-stats-detail">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-slate-300">
                Расшифровка (
                {visibleLinesByClient.reduce((n, g) => n + g.lines.length, 0)})
              </h2>
              {trainerId && showTrainerFilter && (
                <button
                  type="button"
                  className="text-xs text-fitgo-400 underline"
                  onClick={() => setTrainerId('')}
                >
                  Все тренеры
                </button>
              )}
            </div>
            {visibleLinesByClient.length === 0 && (
              <p className="text-sm text-slate-500">Нет проведённых ПТ</p>
            )}
            {visibleLinesByClient.map((group) => (
              <div
                key={group.key}
                className="overflow-hidden rounded-xl border border-slate-800"
              >
                <div className="border-b border-slate-800 bg-slate-900/50 px-3 py-2 text-sm font-medium text-white">
                  {group.name}
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {group.lines.length} зан.
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-[11px] uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-1.5 font-medium">Когда</th>
                        {audience !== 'trainer' && (
                          <th className="px-3 py-1.5 font-medium">Тренер</th>
                        )}
                        <th className="px-3 py-1.5 font-medium">Откуда</th>
                        <th className="px-3 py-1.5 font-medium">Оплата</th>
                        <th className="px-3 py-1.5 font-medium">Цена</th>
                        <th className="px-3 py-1.5 font-medium">%</th>
                        <th className="px-3 py-1.5 font-medium">Начислено</th>
                        <th className="px-3 py-1.5 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {group.lines.map((l) => {
                          const day = l.occurredAt.slice(0, 10);
                          const control = bookingHref(
                            audience,
                            l.sessionKey,
                            day,
                          );
                          const sale = saleHref(audience, l);
                          return (
                            <tr
                              key={`${l.sessionKey}-${l.occurredAt}`}
                              className="border-t border-slate-800/70"
                            >
                              <td className="px-3 py-2 whitespace-nowrap text-slate-300">
                                {fmtWhen(l.occurredAt)}
                              </td>
                              {audience !== 'trainer' && (
                                <td className="px-3 py-2 text-slate-400">
                                  {l.trainerName}
                                </td>
                              )}
                              <td className="px-3 py-2 text-slate-300">
                                {ptStatsOriginLabelRu(l.origin)}
                              </td>
                              <td className="px-3 py-2 text-slate-300">
                                {ptStatsPaymentLabelRu(l.payment)}
                              </td>
                              <td className="px-3 py-2 text-slate-300">
                                {money(l.priceMinor, report.currency)}
                              </td>
                              <td className="px-3 py-2 text-slate-400">
                                {l.ratePercent ?? '—'}
                              </td>
                              <td className="px-3 py-2 text-fitgo-300">
                                {money(l.earnMinor, report.currency)}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap text-xs">
                                <a
                                  href={control}
                                  className="text-fitgo-400 underline"
                                >
                                  Контроль
                                </a>
                                {sale && (
                                  <>
                                    {' · '}
                                    <a
                                      href={sale}
                                      className="text-fitgo-400 underline"
                                    >
                                      Продажа
                                    </a>
                                  </>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
