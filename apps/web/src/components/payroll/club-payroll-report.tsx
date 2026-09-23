'use client';

import type { ClubPayrollReport, StaffPaySummary } from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function money(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)}\u00a0${currency}`;
}

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

type Props = {
  staff?: StaffPaySummary[];
  open: boolean;
  onToggle: () => void;
  onSelectEmployee?: (userId: string, from: string, to: string) => void;
};

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
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [corpAmount, setCorpAmount] = useState('');
  const [corpMsg, setCorpMsg] = useState('');
  const [corpSaving, setCorpSaving] = useState(false);

  const managers = useMemo(() => {
    const withSalary = staff.filter(
      (s) => s.roles.includes('ADMIN') && s.baseSalaryMinor > 0,
    );
    if (withSalary.length) return withSalary;
    return staff.filter((s) => s.roles.includes('ADMIN'));
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
      const r = await api.payrollClubSummary(token, {
        from,
        to,
        department: department === 'ALL' ? undefined : department,
      });
      setReport(r);
      await loadCorp();
    } catch (e) {
      setReport(null);
      setMessage(e instanceof Error ? e.message : 'Ошибка отчёта');
    } finally {
      setLoading(false);
    }
  };

  const downloadXlsx = async () => {
    const token = getToken();
    if (!token) return;
    setExporting(true);
    setMessage('');
    try {
      const blob = await api.payrollClubSummaryXlsx(token, {
        from,
        to,
        department: department === 'ALL' ? undefined : department,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ZP_${from}_${to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка Excel');
    } finally {
      setExporting(false);
    }
  };

  const printReport = () => {
    if (!report) return;
    const w = window.open('', '_blank');
    if (!w) return;
    const rows = report.sections
      .map((s) => {
        const body = s.rows
          .map(
            (r) =>
              `<tr><td>${escape(r.name)}</td><td>${money(r.totalEarnedMinor, r.currency)}</td><td>${money(r.advancePaidMinor, r.currency)}</td><td>${money(r.cardPaidMinor, r.currency)}</td><td>${money(r.settlementPaidMinor, r.currency)}</td><td>${money(r.periodPaidTotalMinor, r.currency)}</td></tr>`,
          )
          .join('');
        return `<h2>${escape(s.label)}</h2><table><thead><tr><th>ФИО</th><th>Начислено</th><th>Аванс</th><th>Карта</th><th>ЗП 15</th><th>Итого</th></tr></thead><tbody>${body}</tbody></table>`;
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
      setCorpMsg('Нет управляющего в Staff (админ с окладом)');
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
            Аванс · карта · ЗП 15 · итого; ФИО открывает отчёт по сотруднику
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
            <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              С
              <input
                type="date"
                className="input mt-1 w-[9.5rem] py-1.5 text-sm"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              По
              <input
                type="date"
                className="input mt-1 w-[9.5rem] py-1.5 text-sm"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
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
              disabled={!report || exporting}
              onClick={downloadXlsx}
            >
              Excel
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

          {report && (
            <div className="space-y-3">
              {report.sections.map((section) => (
                <div key={section.id}>
                  <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-400/80">
                    {section.label}
                    <span className="ml-2 font-normal normal-case text-slate-500">
                      {money(section.totals.totalEarnedMinor, report.currency)}
                    </span>
                  </h3>
                  <div className="overflow-x-auto rounded-lg border border-slate-800">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-slate-900/90 text-[10px] uppercase text-slate-500">
                        <tr>
                          <th className="px-2 py-1.5">ФИО</th>
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
          )}
        </div>
      )}
    </section>
  );
}

function escape(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
