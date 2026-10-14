'use client';

import type {
  ClubPayrollReport,
  ClubPayrollRow,
  ClubPayrollSectionId,
  StaffPaySummary,
} from '@fitgo/shared-types';
import { sameSlicePreviousMonth } from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateField } from '@/components/ui/date-field';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function money(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)}\u00a0${currency}`;
}

function moneyShort(minor: number) {
  return (minor / 100).toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatRangeRu(from: string, to: string) {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  };
  return `${fmt(from)} – ${fmt(to)}`;
}

function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

function DeltaBadge({
  current,
  previous,
}: {
  current: number;
  previous: number;
}) {
  const pct = deltaPct(current, previous);
  if (pct == null) {
    return <span className="text-[10px] text-slate-600">нет базы</span>;
  }
  const up = pct > 0;
  const flat = pct === 0;
  return (
    <span
      className={
        flat
          ? 'text-[10px] tabular-nums text-slate-500'
          : up
            ? 'text-[10px] tabular-nums text-emerald-400'
            : 'text-[10px] tabular-nums text-amber-300'
      }
    >
      {up ? '+' : ''}
      {pct}%
      <span className="ml-1 text-slate-600">
        было {moneyShort(previous)}
      </span>
    </span>
  );
}

type Dept =
  | 'ALL'
  | 'MANAGER'
  | 'ADMIN'
  | 'TRAINER'
  | 'SPECIALIST'
  | 'TECH'
  | 'EXTERNAL';

const DEPTS: { id: Dept; label: string }[] = [
  { id: 'ALL', label: 'Все' },
  { id: 'MANAGER', label: 'Упр.' },
  { id: 'ADMIN', label: 'Админы' },
  { id: 'TRAINER', label: 'Тренеры' },
  { id: 'SPECIALIST', label: 'SPA' },
  { id: 'TECH', label: 'Тех' },
  { id: 'EXTERNAL', label: 'Сторонние' },
];

const SECTION_SHORT: Record<ClubPayrollSectionId, string> = {
  MANAGER: 'Упр.',
  ADMIN: 'Админы',
  TRAINER: 'Тренеры',
  SPECIALIST: 'SPA',
  TECH: 'Тех',
  EXTERNAL: 'Сторонние',
};

type Props = {
  staff?: StaffPaySummary[];
  open: boolean;
  onToggle: () => void;
  onSelectEmployee?: (userId: string, from: string, to: string) => void;
};

function CompositionBar({
  base,
  motivation,
  bonus,
  fine,
}: {
  base: number;
  motivation: number;
  bonus: number;
  fine: number;
}) {
  const parts = [
    { key: 'base', v: Math.max(0, base), className: 'bg-slate-500' },
    { key: 'mot', v: Math.max(0, motivation), className: 'bg-fitgo-500' },
    { key: 'bonus', v: Math.max(0, bonus), className: 'bg-emerald-400' },
    { key: 'fine', v: Math.max(0, fine), className: 'bg-rose-400/80' },
  ];
  const total = parts.reduce((a, p) => a + p.v, 0);
  if (total <= 0) {
    return <div className="h-1.5 w-full rounded-full bg-slate-800" />;
  }
  return (
    <div
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-800"
      title="оклад / мотивация / премии / штрафы"
    >
      {parts
        .filter((p) => p.v > 0)
        .map((p) => (
          <div
            key={p.key}
            className={p.className}
            style={{ width: `${(p.v / total) * 100}%` }}
          />
        ))}
    </div>
  );
}

function SalesCell({
  sold,
  contrib,
  currency,
}: {
  sold: number;
  contrib: number;
  currency: string;
}) {
  if (!sold && !contrib) {
    return <span className="text-slate-600">—</span>;
  }
  return (
    <span className="tabular-nums">
      <span className="text-slate-300">{money(sold, currency)}</span>
      <span className="mx-1 text-slate-600">→</span>
      <span className="text-emerald-300/90">{money(contrib, currency)}</span>
    </span>
  );
}

function PictureStaffTable({
  sectionId,
  rows,
  prevByUser,
  currency,
  from,
  to,
  onSelectEmployee,
}: {
  sectionId: ClubPayrollSectionId;
  rows: ClubPayrollRow[];
  prevByUser: Map<string, ClubPayrollRow>;
  currency: string;
  from: string;
  to: string;
  onSelectEmployee?: (userId: string, from: string, to: string) => void;
}) {
  const isDesk = sectionId === 'MANAGER' || sectionId === 'ADMIN';
  const isTrainer = sectionId === 'TRAINER';
  const isSpa = sectionId === 'SPECIALIST';

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-slate-900/90 text-[10px] uppercase text-slate-500">
          <tr>
            <th className="px-2 py-1.5">ФИО</th>
            {isDesk && (
              <>
                <th className="px-2 py-1.5">Абонементы</th>
                <th className="px-2 py-1.5">SPA</th>
                <th className="px-2 py-1.5">Солярий</th>
                <th className="px-2 py-1.5">Магазин</th>
                <th className="px-2 py-1.5">Корпо</th>
              </>
            )}
            {isTrainer && (
              <>
                <th className="px-2 py-1.5">ПТ / %</th>
                <th className="px-2 py-1.5">ГП</th>
                <th className="px-2 py-1.5">Часы</th>
              </>
            )}
            {isSpa && <th className="px-2 py-1.5">Услуги</th>}
            {(sectionId === 'TECH' || sectionId === 'EXTERNAL') && (
              <>
                <th className="px-2 py-1.5">Часы</th>
                <th className="px-2 py-1.5">Оклад</th>
                <th className="px-2 py-1.5">Премии</th>
                <th className="px-2 py-1.5">Штрафы</th>
              </>
            )}
            <th className="px-2 py-1.5">Начислено</th>
            <th className="px-2 py-1.5">Δ</th>
            <th className="px-2 py-1.5">К выдаче</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const prev = prevByUser.get(r.userId);
            return (
              <tr
                key={r.userId}
                className="border-t border-slate-800/80 text-slate-200"
              >
                <td className="px-2 py-1.5 font-medium">
                  {onSelectEmployee ? (
                    <button
                      type="button"
                      className="text-left text-fitgo-300 hover:underline"
                      onClick={() => onSelectEmployee(r.userId, from, to)}
                    >
                      {r.name}
                    </button>
                  ) : (
                    r.name
                  )}
                  {r.payChips.length > 0 && isDesk ? (
                    <p className="mt-0.5 max-w-[12rem] truncate text-[10px] font-normal text-slate-500">
                      {r.payChips.join(' · ')}
                    </p>
                  ) : null}
                </td>
                {isDesk && (
                  <>
                    <td className="px-2 py-1.5">
                      <SalesCell
                        sold={r.sales?.membershipMinor ?? 0}
                        contrib={r.motivationBreakdown?.membershipMinor ?? 0}
                        currency={currency}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <SalesCell
                        sold={r.sales?.massageMinor ?? 0}
                        contrib={r.motivationBreakdown?.spaMinor ?? 0}
                        currency={currency}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <SalesCell
                        sold={r.sales?.solariumMinor ?? 0}
                        contrib={r.motivationBreakdown?.solariumMinor ?? 0}
                        currency={currency}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <SalesCell
                        sold={r.sales?.shopMinor ?? 0}
                        contrib={r.motivationBreakdown?.shopMinor ?? 0}
                        currency={currency}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <SalesCell
                        sold={r.sales?.corporateMinor ?? 0}
                        contrib={r.motivationBreakdown?.corporateMinor ?? 0}
                        currency={currency}
                      />
                    </td>
                  </>
                )}
                {isTrainer && (
                  <>
                    <td className="px-2 py-1.5 tabular-nums text-slate-400">
                      {r.ptStats
                        ? `${r.ptStats.sessionCount} · ${r.ptStats.percent}%`
                        : r.workUnitCounts.pt > 0
                          ? String(r.workUnitCounts.pt)
                          : '—'}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {r.workUnitCounts.group || '—'}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {r.workUnitCounts.shiftHours
                        ? `${r.workUnitCounts.shiftHours} ч`
                        : '—'}
                    </td>
                  </>
                )}
                {isSpa && (
                  <td className="px-2 py-1.5 tabular-nums">
                    {r.workUnitCounts.spa || '—'}
                  </td>
                )}
                {(sectionId === 'TECH' || sectionId === 'EXTERNAL') && (
                  <>
                    <td className="px-2 py-1.5 tabular-nums">
                      {r.workUnitCounts.shiftHours
                        ? `${r.workUnitCounts.shiftHours} ч`
                        : '—'}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {money(r.baseSalaryMinor, currency)}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {r.bonusMinor ? money(r.bonusMinor, currency) : '—'}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {r.fineMinor ? money(r.fineMinor, currency) : '—'}
                    </td>
                  </>
                )}
                <td className="px-2 py-1.5 tabular-nums text-white">
                  {money(r.totalEarnedMinor, currency)}
                </td>
                <td className="px-2 py-1.5">
                  <DeltaBadge
                    current={r.totalEarnedMinor}
                    previous={prev?.totalEarnedMinor ?? 0}
                  />
                </td>
                <td className="px-2 py-1.5 tabular-nums text-emerald-300">
                  {money(r.toPayMinor, currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ClubPayrollReportPanel({
  staff = [],
  open,
  onToggle,
  onSelectEmployee,
}: Props) {
  const today = new Date();
  const [from, setFrom] = useState(() =>
    isoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
  );
  const [to, setTo] = useState(isoDate(today));
  const [department, setDepartment] = useState<Dept>('ALL');
  const [report, setReport] = useState<ClubPayrollReport | null>(null);
  const [compare, setCompare] = useState<ClubPayrollReport | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPicture, setExportingPicture] = useState(false);
  const [corpAmount, setCorpAmount] = useState('');
  const [corpMsg, setCorpMsg] = useState('');
  const [corpSaving, setCorpSaving] = useState(false);
  const [expandedSection, setExpandedSection] = useState<
    ClubPayrollSectionId | null
  >(null);

  const compareRange = useMemo(
    () => sameSlicePreviousMonth(from, to),
    [from, to],
  );

  const managers = useMemo(() => {
    return staff.filter((s) => s.roles.includes('MANAGER'));
  }, [staff]);

  const primaryManagerId = managers[0]?.userId ?? '';
  const showCorp = department === 'ALL' || department === 'MANAGER';

  const loadCorp = useCallback(async () => {
    if (!showCorp || !primaryManagerId) {
      setCorpAmount('');
      return;
    }
    const token = getToken();
    if (!token) return;
    try {
      const rows = await api.payrollCorporateSales(token, { from, to });
      const mine =
        rows.find((r) => r.userId === primaryManagerId) ??
        rows.find((r) => managers.some((m) => m.userId === r.userId)) ??
        rows[0];
      setCorpAmount(
        mine ? String(Number((mine.amountMinor / 100).toFixed(2))) : '',
      );
      setCorpMsg('');
    } catch {
      /* ignore */
    }
  }, [showCorp, primaryManagerId, from, to, managers]);

  useEffect(() => {
    void loadCorp();
  }, [loadCorp]);

  const load = async () => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setMessage('');
    try {
      const dept = department === 'ALL' ? undefined : department;
      const cmp = sameSlicePreviousMonth(from, to);
      const [r, c] = await Promise.all([
        api.payrollClubSummary(token, { from, to, department: dept }),
        api.payrollClubSummary(token, {
          from: cmp.from,
          to: cmp.to,
          department: dept,
        }),
      ]);
      setReport(r);
      setCompare(c);
      setExpandedSection(null);
      await loadCorp();
    } catch (e) {
      setReport(null);
      setCompare(null);
      setMessage(e instanceof Error ? e.message : 'Ошибка отчёта');
    } finally {
      setLoading(false);
    }
  };

  const downloadXlsx = async (picture: boolean) => {
    const token = getToken();
    if (!token) return;
    if (picture) setExportingPicture(true);
    else setExporting(true);
    setMessage('');
    try {
      const blob = await api.payrollClubSummaryXlsx(token, {
        from,
        to,
        department: department === 'ALL' ? undefined : department,
        picture,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = picture
        ? `ZP_picture_${from}_${to}.xlsx`
        : `ZP_${from}_${to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка Excel');
    } finally {
      setExporting(false);
      setExportingPicture(false);
    }
  };

  const printReport = () => {
    if (!report) return;
    const w = window.open('', '_blank');
    if (!w) return;
    const rows = report.sections
      .map((s) => {
        const body = s.rows
          .map((r) => {
            const pt =
              r.ptStats != null
                ? `${r.ptStats.sessionCount} / ${r.ptStats.percent}%`
                : r.workUnitCounts.pt > 0
                  ? String(r.workUnitCounts.pt)
                  : '—';
            return `<tr><td>${escape(r.name)}</td><td>${escape(pt)}</td><td>${money(r.totalEarnedMinor, r.currency)}</td><td>${money(r.advancePaidMinor, r.currency)}</td><td>${money(r.cardPaidMinor, r.currency)}</td><td>${money(r.settlementPaidMinor, r.currency)}</td><td>${money(r.periodPaidTotalMinor, r.currency)}</td></tr>`;
          })
          .join('');
        return `<h2>${escape(s.label)}</h2><table><thead><tr><th>ФИО</th><th>ПТ / %</th><th>Начислено</th><th>Аванс</th><th>Карта</th><th>ЗП 15</th><th>Итого</th></tr></thead><tbody>${body}</tbody></table>`;
      })
      .join('');
    w.document.write(
      `<!doctype html><html><head><title>ЗП ${report.from}—${report.to}</title><style>body{font-family:system-ui;padding:16px}table{border-collapse:collapse;width:100%;margin-bottom:16px}th,td{border:1px solid #ccc;padding:4px 6px;font-size:12px}h1{font-size:16px}h2{font-size:13px;margin-top:16px}</style></head><body><h1>Сводная ЗП ${report.from} — ${report.to}</h1>${rows}<p><b>Итого:</b> ${money(report.grandTotalMinor, report.currency)}</p></body></html>`,
    );
    w.document.close();
    w.print();
  };

  const saveCorporate = async () => {
    const token = getToken();
    if (!token || !primaryManagerId) {
      setCorpMsg('Нет управляющего в Staff (роль Управляющий)');
      return;
    }
    setCorpSaving(true);
    setCorpMsg('');
    try {
      await api.payrollUpsertCorporateSale(token, {
        userId: primaryManagerId,
        periodFrom: from,
        periodTo: to,
        amountMinor: Math.round(Number(corpAmount || 0) * 100),
      });
      setCorpMsg('Корпо сохранено');
    } catch (e) {
      setCorpMsg(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setCorpSaving(false);
    }
  };

  const pictureTotals = useMemo(() => {
    if (!report) return null;
    const rows = report.sections.flatMap((s) => s.rows);
    const prevRows = compare?.sections.flatMap((s) => s.rows) ?? [];
    const earned = report.grandTotalMinor;
    const paid = rows.reduce((a, r) => a + r.periodPaidTotalMinor, 0);
    const toPay = rows.reduce((a, r) => a + r.toPayMinor, 0);
    const people = new Set(rows.map((r) => r.userId)).size;
    const earnedPrev = compare?.grandTotalMinor ?? 0;
    const paidPrev = prevRows.reduce((a, r) => a + r.periodPaidTotalMinor, 0);
    const toPayPrev = prevRows.reduce((a, r) => a + r.toPayMinor, 0);
    const peoplePrev = new Set(prevRows.map((r) => r.userId)).size;
    return {
      earned,
      paid,
      toPay,
      people,
      earnedPrev,
      paidPrev,
      toPayPrev,
      peoplePrev,
      currency: report.currency,
    };
  }, [report, compare]);

  const prevByUser = useMemo(() => {
    const map = new Map<string, ClubPayrollRow>();
    if (!compare) return map;
    for (const s of compare.sections) {
      for (const r of s.rows) map.set(r.userId, r);
    }
    return map;
  }, [compare]);

  const prevBySection = useMemo(() => {
    const map = new Map<
      ClubPayrollSectionId,
      ClubPayrollReport['sections'][number]
    >();
    if (!compare) return map;
    for (const s of compare.sections) map.set(s.id, s);
    return map;
  }, [compare]);

  const expanded = report?.sections.find((s) => s.id === expandedSection);

  return (
    <section className="rounded-xl border border-emerald-900/40 bg-slate-950/80">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left md:px-4"
        onClick={onToggle}
      >
        <div>
          <h2 className="text-base font-semibold text-white">Сводный отчёт</h2>
          <p className="text-[11px] text-slate-500">
            Картина по подразделениям · сравнение с прошлым месяцем · Excel
          </p>
        </div>
        <span className="text-slate-400">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-emerald-900/30 px-3 pb-3 pt-3 md:px-4">
          <div className="flex flex-wrap gap-1.5">
            {DEPTS.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDepartment(d.id)}
                className={
                  department === d.id
                    ? 'btn-primary px-2.5 py-1 text-xs'
                    : 'btn-secondary px-2.5 py-1 text-xs'
                }
              >
                {d.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <DateField
              label="С"
              value={from}
              onChange={setFrom}
              className="w-[9.5rem]"
              inputClassName="text-sm"
            />
            <DateField
              label="По"
              value={to}
              onChange={setTo}
              className="w-[9.5rem]"
              inputClassName="text-sm"
            />
            <button
              type="button"
              className="btn-primary px-3 py-1.5 text-sm"
              disabled={loading}
              onClick={load}
            >
              {loading ? '…' : 'Сформировать'}
            </button>
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-sm"
              disabled={!report || exportingPicture}
              onClick={() => void downloadXlsx(true)}
              title="Картина: сводка, сотрудники, продажи"
            >
              {exportingPicture ? '…' : 'Excel картины'}
            </button>
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-sm"
              disabled={!report || exporting}
              onClick={() => void downloadXlsx(false)}
            >
              {exporting ? '…' : 'Excel'}
            </button>
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-sm"
              disabled={!report}
              onClick={printReport}
            >
              Печать
            </button>
          </div>

          <p className="text-[11px] text-slate-500">
            Сравнение с {formatRangeRu(compareRange.from, compareRange.to)}{' '}
            (тот же отрезок прошлого месяца)
          </p>

          {showCorp && (
            <div className="flex flex-wrap items-end gap-2 border-t border-slate-800/80 pt-3">
              <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                Корпо (р/с), BYN
                <input
                  className="input mt-1 w-28 py-1.5 text-sm"
                  inputMode="decimal"
                  placeholder="0"
                  value={corpAmount}
                  onChange={(e) => setCorpAmount(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn-secondary px-3 py-1.5 text-sm"
                disabled={corpSaving || !primaryManagerId}
                onClick={saveCorporate}
              >
                {corpSaving ? '…' : 'Сохранить корпо'}
              </button>
              {corpMsg && (
                <span className="pb-1.5 text-xs text-emerald-300/90">
                  {corpMsg}
                </span>
              )}
              {!primaryManagerId && (
                <span className="pb-1.5 text-xs text-amber-300/80">
                  Нужен админ с окладом в Staff
                </span>
              )}
            </div>
          )}

          {message && (
            <p className="text-xs text-amber-300/90">{message}</p>
          )}

          {!report && !loading && (
            <p className="rounded-lg border border-dashed border-slate-800 px-3 py-6 text-center text-xs text-slate-500">
              Выберите период и нажмите «Сформировать»
            </p>
          )}

          {pictureTotals && report && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {(
                  [
                    {
                      label: 'Начислено',
                      value: pictureTotals.earned,
                      prev: pictureTotals.earnedPrev,
                      emphasize: false,
                    },
                    {
                      label: 'Выплачено',
                      value: pictureTotals.paid,
                      prev: pictureTotals.paidPrev,
                      emphasize: false,
                    },
                    {
                      label: 'К выдаче',
                      value: pictureTotals.toPay,
                      prev: pictureTotals.toPayPrev,
                      emphasize: true,
                    },
                  ] as const
                ).map((tile) => (
                  <div
                    key={tile.label}
                    className={`rounded-xl border px-2.5 py-2 ${
                      tile.emphasize
                        ? 'border-fitgo-500/40 bg-fitgo-500/10'
                        : 'border-slate-800 bg-slate-950/50'
                    }`}
                  >
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      {tile.label}
                    </p>
                    <p
                      className={`mt-1 font-semibold tabular-nums ${
                        tile.emphasize
                          ? 'text-lg text-fitgo-300'
                          : 'text-base text-white'
                      }`}
                    >
                      {money(tile.value, pictureTotals.currency)}
                    </p>
                    <div className="mt-0.5">
                      <DeltaBadge current={tile.value} previous={tile.prev} />
                    </div>
                  </div>
                ))}
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-2.5 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                    Люди
                  </p>
                  <p className="mt-1 text-base font-semibold tabular-nums text-white">
                    {pictureTotals.people}
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    было {pictureTotals.peoplePrev}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {report.sections.map((section) => {
                  const prev = prevBySection.get(section.id);
                  const paid = section.rows.reduce(
                    (a, r) => a + r.periodPaidTotalMinor,
                    0,
                  );
                  const active = expandedSection === section.id;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() =>
                        setExpandedSection((cur) =>
                          cur === section.id ? null : section.id,
                        )
                      }
                      className={`rounded-xl border px-2.5 py-2 text-left transition ${
                        active
                          ? 'border-fitgo-500/50 bg-fitgo-500/10'
                          : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
                      }`}
                    >
                      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                        {SECTION_SHORT[section.id]}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {section.rows.length} чел.
                      </p>
                      <p className="mt-1 text-sm font-semibold tabular-nums text-white">
                        {money(section.totals.totalEarnedMinor, report.currency)}
                      </p>
                      <div className="mt-0.5">
                        <DeltaBadge
                          current={section.totals.totalEarnedMinor}
                          previous={prev?.totals.totalEarnedMinor ?? 0}
                        />
                      </div>
                      <p className="mt-1 text-[10px] tabular-nums text-slate-500">
                        выпл. {moneyShort(paid)} · к выдаче{' '}
                        {moneyShort(section.totals.toPayMinor)}
                      </p>
                      <div className="mt-2">
                        <CompositionBar
                          base={section.totals.baseSalaryMinor}
                          motivation={section.totals.motivationMinor}
                          bonus={section.totals.bonusMinor}
                          fine={section.totals.fineMinor}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>

              {expanded && (
                <div className="space-y-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400/80">
                    {expanded.label}
                    <span className="ml-2 font-normal normal-case text-slate-500">
                      {isDeskHint(expanded.id)}
                    </span>
                  </h3>
                  <PictureStaffTable
                    sectionId={expanded.id}
                    rows={expanded.rows}
                    prevByUser={prevByUser}
                    currency={report.currency}
                    from={from}
                    to={to}
                    onSelectEmployee={onSelectEmployee}
                  />
                </div>
              )}

              <div className="border-t border-slate-800/80 pt-3">
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Детализация выплат
                </h3>
                {report.sections.map((section) => (
                  <div key={`detail-${section.id}`} className="mb-3">
                    <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-400/80">
                      {section.label}
                      <span className="ml-2 font-normal normal-case text-slate-500">
                        {money(section.totals.totalEarnedMinor, report.currency)}
                      </span>
                    </h4>
                    <div className="overflow-x-auto rounded-lg border border-slate-800">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-slate-900/90 text-[10px] uppercase text-slate-500">
                          <tr>
                            <th className="px-2 py-1.5">ФИО</th>
                            <th className="px-2 py-1.5">ПТ / %</th>
                            <th className="px-2 py-1.5">Начисл.</th>
                            <th className="px-2 py-1.5">Аванс</th>
                            <th className="px-2 py-1.5">Карта</th>
                            <th className="px-2 py-1.5">ЗП 15</th>
                            <th className="px-2 py-1.5">Итого</th>
                            <th className="px-2 py-1.5">К выдаче</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.rows.map((r) => (
                            <tr
                              key={r.userId}
                              className="border-t border-slate-800/80 text-slate-200"
                            >
                              <td className="px-2 py-1 font-medium">
                                {onSelectEmployee ? (
                                  <button
                                    type="button"
                                    className="text-left text-fitgo-300 hover:underline"
                                    onClick={() =>
                                      onSelectEmployee(r.userId, from, to)
                                    }
                                  >
                                    {r.name}
                                  </button>
                                ) : (
                                  r.name
                                )}
                              </td>
                              <td className="px-2 py-1 tabular-nums text-slate-400">
                                {r.ptStats
                                  ? `${r.ptStats.sessionCount} · ${r.ptStats.percent}%`
                                  : r.workUnitCounts.pt > 0
                                    ? String(r.workUnitCounts.pt)
                                    : '—'}
                              </td>
                              <td className="px-2 py-1 tabular-nums">
                                {money(r.totalEarnedMinor, r.currency)}
                              </td>
                              <td className="px-2 py-1 tabular-nums">
                                {r.advancePaidMinor
                                  ? money(r.advancePaidMinor, r.currency)
                                  : '—'}
                              </td>
                              <td className="px-2 py-1 tabular-nums">
                                {r.cardPaidMinor
                                  ? money(r.cardPaidMinor, r.currency)
                                  : '—'}
                              </td>
                              <td className="px-2 py-1 tabular-nums">
                                {r.settlementPaidMinor
                                  ? money(r.settlementPaidMinor, r.currency)
                                  : '—'}
                              </td>
                              <td className="px-2 py-1 tabular-nums text-white">
                                {money(r.periodPaidTotalMinor, r.currency)}
                              </td>
                              <td className="px-2 py-1 tabular-nums text-emerald-300">
                                {money(r.toPayMinor, r.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-slate-400">
                  Всего начислено:{' '}
                  <span className="font-semibold text-white">
                    {money(report.grandTotalMinor, report.currency)}
                  </span>
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function isDeskHint(id: ClubPayrollSectionId): string {
  if (id === 'MANAGER' || id === 'ADMIN') {
    return 'продано → в мотивацию';
  }
  return '';
}

function escape(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
