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
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DateField } from '@/components/ui/date-field';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import {
  resolveViewFilters,
  usePersistViewMemory,
} from '@/lib/use-view-memory';
import { isIsoDay, readViewMemory, writeViewMemory } from '@/lib/view-memory';

export type PtTimesheetStatsAudience = 'trainer' | 'admin' | 'super';

const CLUB_TZ = 'Europe/Minsk';

type TrainerOption = { id: string; name: string };
type AppliedScope = { from: string; to: string; trainerId: string };
type StatsMem = { from: string; to: string; trainerId: string };

const reportCache = new Map<string, PtStatsReport>();

function cacheKey(
  audience: PtTimesheetStatsAudience,
  from: string,
  to: string,
  trainerId: string,
) {
  return `${audience}|${from}|${to}|${trainerId}`;
}

function clubParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CLUB_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { y: pick('year'), m: pick('month'), d: pick('day') };
}

function isoFromParts(y: number, m: number, day: number) {
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lastDayOfMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Calendar month in the club timezone (not a rolling UTC window). */
function monthBounds(ref = new Date()) {
  const { y, m } = clubParts(ref);
  return {
    from: isoFromParts(y, m, 1),
    to: isoFromParts(y, m, lastDayOfMonth(y, m)),
  };
}

function prevMonthBounds(ref = new Date()) {
  const { y, m } = clubParts(ref);
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  return {
    from: isoFromParts(prev.y, prev.m, 1),
    to: isoFromParts(prev.y, prev.m, lastDayOfMonth(prev.y, prev.m)),
  };
}

function weekBounds(ref = new Date()) {
  const { y, m, d } = clubParts(ref);
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  const day = noon.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const mon = new Date(noon);
  mon.setUTCDate(noon.getUTCDate() + mondayOffset);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  return {
    from: mon.toISOString().slice(0, 10),
    to: sun.toISOString().slice(0, 10),
  };
}

function shiftIsoDay(iso: string, delta: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + delta));
  return dt.toISOString().slice(0, 10);
}

function clubIsoDay(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const { y, m, d: day } = clubParts(d);
  return isoFromParts(y, m, day);
}

/** Cover both the UTC date and the club calendar day so the row is in range. */
function daySpan(iso: string) {
  const utc = /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : clubIsoDay(iso);
  const club = clubIsoDay(iso);
  if (utc === club) return { from: club, to: club };
  return utc < club ? { from: utc, to: club } : { from: club, to: utc };
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
  line: PtStatsSessionLine,
): string {
  const span = daySpan(line.occurredAt);
  const q = new URLSearchParams({ from: span.from, to: span.to, kind: 'PT' });
  if (line.clientName && line.clientName !== '—') q.set('client', line.clientName);
  if (line.clientId) q.set('clientId', line.clientId);
  if (audience === 'trainer') {
    q.set('session', line.sessionKey);
    return `/trainer/my-sessions?${q}`;
  }
  q.set('sessionKey', line.sessionKey);
  if (line.trainerId) q.set('performerId', line.trainerId);
  if (audience === 'super') return `/super-admin/review-queue?${q}`;
  return `/admin/booking-control?${q}`;
}

function saleHref(
  audience: PtTimesheetStatsAudience,
  line: PtStatsSessionLine,
): string | null {
  if (audience === 'trainer') return null;
  const base = audience === 'super' ? '/super-admin/sales' : '/admin/sales';
  const q = new URLSearchParams();
  if (line.saleOccurredAt) {
    const span = daySpan(line.saleOccurredAt);
    q.set('from', span.from);
    q.set('to', span.to);
  } else if (line.origin === 'MEMBERSHIP' || line.origin === 'BLOCK') {
    const span = daySpan(line.occurredAt);
    q.set('from', shiftIsoDay(span.from, -120));
    q.set('to', span.to);
  } else {
    const span = daySpan(line.occurredAt);
    q.set('from', span.from);
    q.set('to', span.to);
  }
  if (line.clientName && line.clientName !== '—') q.set('q', line.clientName);
  if (line.saleExternalId) q.set('externalId', line.saleExternalId);
  else if (!q.get('q')) return null;
  return `${base}?${q}`;
}

export function usePtTimesheetTab() {
  const pathname = usePathname();
  const touched = useRef(false);
  const [tab, setTabState] = useState<'journal' | 'stats' | null>(null);

  useEffect(() => {
    const id = getUser()?.id ?? '';
    const saved = id
      ? readViewMemory<{ tab?: string }>(id, pathname, 'pt-tab')
      : null;
    if (!touched.current) {
      setTabState(saved?.tab === 'stats' ? 'stats' : 'journal');
    }
  }, [pathname]);

  const setTab = (next: 'journal' | 'stats') => {
    touched.current = true;
    setTabState(next);
    const id = getUser()?.id ?? '';
    if (id) writeViewMemory(id, pathname, 'pt-tab', { tab: next });
  };

  return { tab, setTab };
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
  const pathname = usePathname();
  const ownerId = getUser()?.id ?? '';
  const initial = useMemo(() => monthBounds(), []);
  const boot = useMemo(() => {
    const defaults: StatsMem = {
      from: initial.from,
      to: initial.to,
      trainerId: '',
    };
    return resolveViewFilters<StatsMem>({
      userId: ownerId,
      pathname,
      slot: 'stats',
      search: new URLSearchParams(),
      urlKeys: [],
      fromUrl: () => ({}),
      defaults,
    });
    // Client memory is applied after mount — getUser() is empty during SSR.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- defaults only
  }, []);
  const [from, setFrom] = useState(boot.from);
  const [to, setTo] = useState(boot.to);
  const [trainerId, setTrainerId] = useState(boot.trainerId);
  const [trainerOptions, setTrainerOptions] = useState<TrainerOption[]>([]);
  const [applied, setApplied] = useState<AppliedScope | null>(null);
  const [report, setReport] = useState<PtStatsReport | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const reqId = useRef(0);
  const canExport = audience === 'admin' || audience === 'super';
  const showTrainerFilter = audience !== 'trainer';

  useEffect(() => {
    const id = getUser()?.id ?? '';
    const saved = id
      ? readViewMemory<StatsMem>(id, pathname, 'stats')
      : null;
    const nextFrom = isIsoDay(saved?.from) ? saved.from : initial.from;
    const nextTo = isIsoDay(saved?.to) ? saved.to : initial.to;
    const nextTrainer =
      typeof saved?.trainerId === 'string' ? saved.trainerId : '';
    setFrom(nextFrom);
    setTo(nextTo);
    setTrainerId(nextTrainer);
    const hit = reportCache.get(
      cacheKey(audience, nextFrom, nextTo, nextTrainer),
    );
    if (hit) {
      setReport(hit);
      setApplied({ from: nextFrom, to: nextTo, trainerId: nextTrainer });
    }
    setHydrated(true);
  }, [audience, initial.from, initial.to, pathname]);

  usePersistViewMemory<StatsMem>({
    slot: 'stats',
    enabled: hydrated,
    data: { from, to, trainerId },
  });

  useEffect(() => {
    if (!showTrainerFilter) return;
    const token = getToken();
    if (!token) return;
    let cancel = false;
    const timer = window.setTimeout(() => {
      const req =
        audience === 'admin' ? api.adminPtStatsTrainers : api.saPtStatsTrainers;
      void req(token, from, to)
        .then((rows) => {
          if (!cancel) setTrainerOptions(rows);
        })
        .catch(() => {
          if (!cancel) setTrainerOptions([]);
        });
    }, 250);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [audience, from, showTrainerFilter, to]);

  const loadReport = useCallback(
    async (f: string, t: string, tid: string, fresh = false) => {
      const token = getToken();
      if (!token) return;
      const id = ++reqId.current;
      const key = cacheKey(audience, f, t, tid);
      if (!fresh) {
        const hit = reportCache.get(key);
        if (hit) {
          setReport(hit);
          setApplied({ from: f, to: t, trainerId: tid });
          setMessage('');
          setLoading(false);
          return;
        }
      }
      setLoading(true);
      setMessage('');
      try {
        const data =
          audience === 'trainer'
            ? await api.trainerPtStats(token, f, t)
            : audience === 'admin'
              ? await api.adminPtStats(token, f, t, tid || undefined)
              : await api.saPtStats(token, f, t, tid || undefined);
        if (reqId.current !== id) return;
        reportCache.set(key, data);
        if (!tid) {
          for (const tr of data.trainers) {
            reportCache.set(cacheKey(audience, f, t, tr.trainerId), {
              ...data,
              trainerId: tr.trainerId,
              trainers: [tr],
              totals: tr,
              lines: data.lines.filter((l) => l.trainerId === tr.trainerId),
              noNextBooking: data.noNextBooking.filter(
                (g) => g.trainerId === tr.trainerId,
              ),
            });
          }
        }
        setReport(data);
        setApplied({ from: f, to: t, trainerId: tid });
      } catch (e) {
        if (reqId.current !== id) return;
        setReport(null);
        setMessage(e instanceof Error ? e.message : 'Ошибка');
      } finally {
        if (reqId.current === id) setLoading(false);
      }
    },
    [audience],
  );

  useEffect(() => {
    if (!applied) return;
    if (applied.from !== from || applied.to !== to) return;
    if (applied.trainerId === trainerId) return;
    // «Все тренеры» считает весь клуб — только по кнопке, чтобы не тормозить.
    if (!trainerId) return;
    void loadReport(from, to, trainerId);
  }, [applied, from, loadReport, to, trainerId]);

  const setPreset = (kind: 'week' | 'month' | 'prevMonth') => {
    if (kind === 'week') {
      const b = weekBounds();
      setFrom(b.from);
      setTo(b.to);
      return;
    }
    if (kind === 'prevMonth') {
      const b = prevMonthBounds();
      setFrom(b.from);
      setTo(b.to);
      return;
    }
    const b = monthBounds();
    setFrom(b.from);
    setTo(b.to);
  };

  const periodDirty =
    applied != null && (applied.from !== from || applied.to !== to);

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
    const trainers = trainerId
      ? report.trainers.filter((t) => t.trainerId === trainerId)
      : report.trainers;
    const focus =
      trainers.length === 1
        ? trainers[0]!
        : report.totals;
    const cols: PtStatsTrainerSummary[] =
      !trainerId && trainers.length > 1
        ? [...trainers, report.totals]
        : trainers;
    const colLabels = cols.map((t, i) =>
      !trainerId && trainers.length > 1 && i === cols.length - 1
        ? 'ИТОГО'
        : t.trainerName,
    );

    const linesByTrainer = new Map<string, PtStatsSessionLine[]>();
    for (const l of report.lines) {
      if (trainerId && l.trainerId !== trainerId) continue;
      const list = linesByTrainer.get(l.trainerId) ?? [];
      list.push(l);
      linesByTrainer.set(l.trainerId, list);
    }

    const metricRow = (
      label: string,
      pick: (t: PtStatsTrainerSummary) => string | number,
    ) =>
      `<tr><td>${escapeHtml(label)}</td>${cols
        .map((t) => `<td>${escapeHtml(String(pick(t)))}</td>`)
        .join('')}</tr>`;

    const summaryBody = [
      metricRow('Проведено', (t) => t.sessionsConducted),
      metricRow('Неявки', (t) => t.noShowCount),
      metricRow('Отмены', (t) => t.cancelledCount),
      metricRow('Уникальные клиенты', (t) => t.uniqueClients),
      metricRow('Новые', (t) => t.newClients),
      metricRow('Повторные', (t) => t.returningClients),
      metricRow('На клиента', (t) => t.sessionsPerClient ?? '—'),
      metricRow('Удержание %', (t) => t.retentionPct ?? '—'),
      metricRow('Удержание 60–90 %', (t) => t.retention90Pct ?? '—'),
      metricRow('Конверсия %', (t) => t.conversionPct ?? '—'),
      metricRow('Абонемент', (t) => t.mix.membership),
      metricRow('Блок', (t) => t.mix.block),
      metricRow('Разовые', (t) => t.mix.oneShot),
      metricRow('Подарок', (t) => t.mix.gift),
      metricRow('Не распознано', (t) => t.mix.unknown),
      metricRow('Списано', (t) => t.payments.writtenOff),
      metricRow('Оплачено', (t) => t.payments.paid),
      metricRow('Долг', (t) => t.payments.debt),
      metricRow(`Долг ${currency}`, (t) =>
        money(t.payments.debtMinor, currency),
      ),
      metricRow('Смена мин', (t) => t.shiftMinutes),
      metricRow('Смена', (t) => money(t.shiftPayMinor, currency)),
      metricRow('Мотивация', (t) => money(t.sessionMotivationMinor, currency)),
      metricRow('Итого', (t) => money(t.totalEarnMinor, currency)),
      metricRow('Лестница %', (t) => t.ladderPercent ?? '—'),
    ].join('');

    const detailRows = trainers
      .flatMap((t) => {
        const lines = [...(linesByTrainer.get(t.trainerId) ?? [])].sort(
          (a, b) => a.occurredAt.localeCompare(b.occurredAt),
        );
        return lines.map(
          (l) => `<tr>
          <td>${escapeHtml(fmtWhen(l.occurredAt))}</td>
          <td>${escapeHtml(l.trainerName)}</td>
          <td>${escapeHtml(l.clientName)}</td>
          <td>${escapeHtml(ptStatsOriginLabelRu(l.origin))}</td>
          <td>${escapeHtml(ptStatsPaymentLabelRu(l.payment))}</td>
          <td>${money(l.priceMinor, currency)}</td>
          <td>${l.ratePercent ?? '—'}</td>
          <td>${money(l.earnMinor, currency)}</td>
          <td>${escapeHtml(l.title)}</td>
        </tr>`,
        );
      })
      .join('');

    const titleExtra =
      trainers.length === 1 ? ` · ${escapeHtml(trainers[0]!.trainerName)}` : '';

    w.document.write(
      `<!doctype html><html><head><title>Статистика ПТ ${from}—${to}</title>
      <style>
        @page{size:landscape;margin:8mm}
        *{box-sizing:border-box}
        body{font-family:system-ui,sans-serif;padding:8px;color:#111;margin:0}
        h1{font-size:14px;margin:0 0 6px}
        p{font-size:11px;margin:0 0 10px;color:#444}
        h2{font-size:12px;margin:12px 0 4px}
        table{border-collapse:collapse;width:100%;table-layout:fixed}
        th,td{border:1px solid #bbb;padding:2px 4px;font-size:9px;text-align:left;
          overflow:hidden;text-overflow:ellipsis;word-break:break-word;vertical-align:top}
        thead{display:table-header-group}
        tr{page-break-inside:avoid}
      </style></head><body>
      <h1>Статистика ПТ ${from} — ${to}${titleExtra}</h1>
      <p>Проведено: ${focus.sessionsConducted}, начислено: ${money(focus.totalEarnMinor, currency)}</p>
      <h2>Общая информация</h2>
      <table><thead><tr><th>Показатель</th>${colLabels
        .map((n) => `<th>${escapeHtml(n)}</th>`)
        .join('')}</tr></thead><tbody>${summaryBody}</tbody></table>
      <h2>Расшифровка</h2>
      <table><thead><tr>
        <th>Дата</th><th>Тренер</th><th>Клиент</th><th>Откуда</th><th>Оплата</th>
        <th>Цена</th><th>%</th><th>Начислено</th><th>Название</th>
      </tr></thead><tbody>${detailRows}</tbody></table>
      </body></html>`,
    );
    w.document.close();
    w.focus();
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
        {showTrainerFilter && (
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Тренер
            <select
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
              value={trainerId}
              onChange={(e) => setTrainerId(e.target.value)}
            >
              <option value="">Все тренеры</option>
              {trainerOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              {trainerId &&
                !trainerOptions.some((t) => t.id === trainerId) && (
                  <option value={trainerId}>Выбранный тренер</option>
                )}
            </select>
          </label>
        )}
        <button
          type="button"
          className="btn-primary px-3 py-1.5 text-sm"
          disabled={loading}
          onClick={() => void loadReport(from, to, trainerId, true)}
        >
          {loading ? 'Считаю…' : 'Сформировать'}
        </button>
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

      {periodDirty && (
        <p className="text-xs text-slate-500">
          Период изменён — нажмите «Сформировать». Смена тренера в том же
          периоде подгружает только его.
        </p>
      )}

      {loading && (
        <p className="text-sm text-slate-500">
          {trainerId
            ? 'Считаю выбранного тренера…'
            : 'Считаю всех тренеров — это дольше…'}
        </p>
      )}

      {!report && !loading && (
        <p className="text-sm text-slate-500">
          Выберите период
          {showTrainerFilter ? ' и тренера' : ''}, затем нажмите «Сформировать».
          Отчёт не грузится, пока вы его не запросите.
        </p>
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
                          const control = bookingHref(audience, l);
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
                                <Link
                                  href={control}
                                  className="text-fitgo-400 underline"
                                >
                                  Контроль
                                </Link>
                                {sale && (
                                  <>
                                    {' · '}
                                    <Link
                                      href={sale}
                                      className="text-fitgo-400 underline"
                                    >
                                      Продажа
                                    </Link>
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
