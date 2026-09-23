'use client';

import type {
  PayrollPayoutKind,
  PayrollPayoutPreview,
  StaffPaySummary,
} from '@fitgo/shared-types';
import {
  advanceHalfRange,
  monthSettlementRange,
  parseMoneyToMinor,
} from '@fitgo/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function money(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)}\u00a0${currency}`;
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

type RowDraft = {
  card: string;
  cash: string;
  selected: boolean;
};

type Props = {
  staff: StaffPaySummary[];
  open: boolean;
  onToggle: () => void;
};

export function PayrollPayoutsPanel({ staff, open, onToggle }: Props) {
  const today = useMemo(() => new Date(), []);
  const [payYear, setPayYear] = useState(() => today.getFullYear());
  const [payMonth, setPayMonth] = useState(() => today.getMonth() + 1);
  const [payKind, setPayKind] = useState<PayrollPayoutKind>('ADVANCE_HALF');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [department, setDepartment] = useState<Dept>('ALL');
  const [staffId, setStaffId] = useState('');
  const [rows, setRows] = useState<PayrollPayoutPreview[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const defaultRange = useMemo(() => {
    return payKind === 'ADVANCE_HALF'
      ? advanceHalfRange(payYear, payMonth)
      : monthSettlementRange(payYear, payMonth);
  }, [payKind, payYear, payMonth]);

  useEffect(() => {
    setPeriodFrom(defaultRange.from);
    setPeriodTo(defaultRange.to);
    setRows([]);
    setDrafts({});
  }, [defaultRange.from, defaultRange.to]);

  const filteredStaff = useMemo(() => {
    if (department === 'ALL') return staff;
    return staff.filter((s) => {
      if (department === 'EXTERNAL') return s.employmentKind === 'EXTERNAL';
      if (s.employmentKind === 'EXTERNAL') return false;
      if (department === 'MANAGER') {
        return s.roles.includes('ADMIN') && s.baseSalaryMinor > 0;
      }
      if (department === 'ADMIN') {
        return (
          (s.roles.includes('ADMIN') || s.track === 'ADMIN') &&
          !(s.roles.includes('ADMIN') && s.baseSalaryMinor > 0)
        );
      }
      if (department === 'TRAINER') {
        return (
          s.roles.includes('TRAINER') ||
          s.track === 'PT' ||
          s.track === 'GROUP_TRAINER'
        );
      }
      if (department === 'SPECIALIST') {
        return s.roles.includes('SPECIALIST') || s.track === 'SPA';
      }
      if (department === 'TECH') {
        return s.roles.includes('TECH') || s.track === 'TECH';
      }
      return false;
    });
  }, [staff, department]);

  const load = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setMessage('');
    try {
      const list = await api.payrollPayoutBatchPreview(token, {
        kind: payKind,
        year: payYear,
        month: payMonth,
        periodFrom: periodFrom || undefined,
        periodTo: periodTo || undefined,
        department: staffId ? undefined : department,
        userIds: staffId ? [staffId] : undefined,
      });
      setRows(list);
      const next: Record<string, RowDraft> = {};
      for (const p of list) {
        const suggested = Math.max(0, p.payableMinor);
        next[p.performerId] = {
          card: '0',
          cash: String((suggested / 100).toFixed(2)),
          selected: p.existingPayout?.status !== 'PAID' && p.payableMinor !== 0,
        };
      }
      setDrafts(next);
    } catch (e) {
      setRows([]);
      setMessage(e instanceof Error ? e.message : 'Ошибка превью');
    } finally {
      setBusy(false);
    }
  };

  const updateDraft = (
    userId: string,
    patch: Partial<RowDraft>,
    payableMinor?: number,
  ) => {
    setDrafts((prev) => {
      const cur = prev[userId] ?? { card: '0', cash: '0', selected: false };
      const next = { ...cur, ...patch };
      if (patch.card !== undefined && payableMinor !== undefined) {
        const card = parseMoneyToMinor(patch.card || '0');
        next.cash = String(((payableMinor - card) / 100).toFixed(2));
      }
      return { ...prev, [userId]: next };
    });
  };

  const confirmSelected = async () => {
    const token = getToken();
    if (!token) return;
    const items = rows
      .filter((r) => {
        const d = drafts[r.performerId];
        return d?.selected && r.existingPayout?.status !== 'PAID';
      })
      .map((r) => {
        const d = drafts[r.performerId]!;
        return {
          userId: r.performerId,
          cardTransferMinor: parseMoneyToMinor(d.card || '0'),
          actualCashMinor: parseMoneyToMinor(d.cash || '0'),
        };
      });
    if (!items.length) {
      setMessage('Нет выбранных строк для подтверждения');
      return;
    }
    if (
      !window.confirm(
        `Подтвердить ${items.length} выплат(ы) за ${periodFrom}–${periodTo}?`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await api.payrollPayoutConfirmBatch(token, {
        kind: payKind,
        year: payYear,
        month: payMonth,
        periodFrom: periodFrom || undefined,
        periodTo: periodTo || undefined,
        items,
      });
      setMessage(`Подтверждено: ${items.length}`);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка подтверждения');
    } finally {
      setBusy(false);
    }
  };

  const currency = rows[0]?.currency ?? 'BYN';

  return (
    <section className="rounded-xl border border-slate-800/80 bg-slate-950/80">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left md:px-4"
        onClick={onToggle}
      >
        <div>
          <h2 className="text-base font-semibold text-white">
            Выплаты ЗП / Аванс
          </h2>
          <p className="text-[11px] text-slate-500">
            Переключатель 25 / 15, период вручную, факт из кассы и перенос остатка
          </p>
        </div>
        <span className="text-slate-400">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-800 px-3 pb-3 pt-3 md:px-4">
          <div className="flex flex-wrap gap-1.5">
            {DEPTS.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  setDepartment(d.id);
                  setStaffId('');
                }}
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
            <div className="flex rounded-lg border border-slate-700 p-0.5">
              <button
                type="button"
                className={
                  payKind === 'ADVANCE_HALF'
                    ? 'rounded-md bg-emerald-600/30 px-3 py-1.5 text-xs text-emerald-200'
                    : 'px-3 py-1.5 text-xs text-slate-400'
                }
                onClick={() => setPayKind('ADVANCE_HALF')}
              >
                25 · Аванс
              </button>
              <button
                type="button"
                className={
                  payKind === 'MONTH_SETTLEMENT'
                    ? 'rounded-md bg-emerald-600/30 px-3 py-1.5 text-xs text-emerald-200'
                    : 'px-3 py-1.5 text-xs text-slate-400'
                }
                onClick={() => setPayKind('MONTH_SETTLEMENT')}
              >
                15 · Расчёт
              </button>
            </div>
            <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Год
              <input
                type="number"
                className="input mt-1 w-20 py-1.5 text-sm"
                value={payYear}
                onChange={(e) => setPayYear(Number(e.target.value) || payYear)}
              />
            </label>
            <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Месяц волны
              <select
                className="input mt-1 w-20 py-1.5 text-sm"
                value={payMonth}
                onChange={(e) => setPayMonth(Number(e.target.value))}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, '0')}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              С
              <input
                type="date"
                className="input mt-1 w-[9.5rem] py-1.5 text-sm"
                value={periodFrom}
                onChange={(e) => setPeriodFrom(e.target.value)}
              />
            </label>
            <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              По
              <input
                type="date"
                className="input mt-1 w-[9.5rem] py-1.5 text-sm"
                value={periodTo}
                onChange={(e) => setPeriodTo(e.target.value)}
              />
            </label>
            <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Сотрудник
              <select
                className="input mt-1 min-w-[12rem] py-1.5 text-sm"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
              >
                <option value="">Все из фильтра</option>
                {filteredStaff.map((s) => (
                  <option key={s.userId} value={s.userId}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn-primary px-3 py-1.5 text-sm"
              disabled={busy}
              onClick={load}
            >
              {busy ? '…' : 'Рассчитать'}
            </button>
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-sm"
              disabled={busy || !rows.length}
              onClick={confirmSelected}
            >
              Подтвердить выплаты
            </button>
          </div>

          {(periodFrom !== defaultRange.from ||
            periodTo !== defaultRange.to) && (
            <p className="text-[11px] text-amber-300/90">
              Период изменён (по умолчанию {defaultRange.from}–{defaultRange.to}
              )
            </p>
          )}

          {message && (
            <p className="text-xs text-amber-300/90">{message}</p>
          )}

          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-900/90 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5"> </th>
                    <th className="px-2 py-1.5">ФИО</th>
                    <th className="px-2 py-1.5">Начислено</th>
                    <th className="px-2 py-1.5">Перенос</th>
                    <th className="px-2 py-1.5">К выплате</th>
                    <th className="px-2 py-1.5">Карта</th>
                    <th className="px-2 py-1.5">Из кассы</th>
                    <th className="px-2 py-1.5">Δ</th>
                    <th className="px-2 py-1.5">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const d = drafts[r.performerId] ?? {
                      card: '0',
                      cash: '0',
                      selected: false,
                    };
                    const card = parseMoneyToMinor(d.card || '0');
                    const cash = parseMoneyToMinor(d.cash || '0');
                    const delta = r.payableMinor - (card + cash);
                    const paid = r.existingPayout?.status === 'PAID';
                    return (
                      <tr
                        key={r.performerId}
                        className="border-t border-slate-800/80 text-slate-200"
                      >
                        <td className="px-2 py-1">
                          <input
                            type="checkbox"
                            disabled={paid}
                            checked={d.selected && !paid}
                            onChange={(e) =>
                              updateDraft(r.performerId, {
                                selected: e.target.checked,
                              })
                            }
                          />
                        </td>
                        <td className="px-2 py-1 font-medium">
                          {r.performerName}
                          {r.usesFixedAdvance && (
                            <span className="ml-1 text-[10px] text-fitgo-300">
                              фикс
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1 tabular-nums">
                          {money(r.totalMinor, currency)}
                        </td>
                        <td className="px-2 py-1 tabular-nums text-slate-400">
                          {r.carryInMinor
                            ? money(r.carryInMinor, currency)
                            : '—'}
                        </td>
                        <td className="px-2 py-1 tabular-nums text-emerald-300">
                          {money(r.payableMinor, currency)}
                        </td>
                        <td className="px-2 py-1">
                          <input
                            className="input w-20 py-1 text-xs"
                            disabled={paid}
                            inputMode="decimal"
                            value={d.card}
                            onChange={(e) =>
                              updateDraft(
                                r.performerId,
                                { card: e.target.value },
                                r.payableMinor,
                              )
                            }
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            className="input w-20 py-1 text-xs"
                            disabled={paid}
                            inputMode="decimal"
                            value={d.cash}
                            onChange={(e) =>
                              updateDraft(r.performerId, {
                                cash: e.target.value,
                              })
                            }
                          />
                        </td>
                        <td
                          className={`px-2 py-1 tabular-nums ${
                            delta === 0
                              ? 'text-slate-500'
                              : delta > 0
                                ? 'text-amber-300'
                                : 'text-sky-300'
                          }`}
                        >
                          {delta === 0
                            ? '—'
                            : `${delta > 0 ? '+' : ''}${(delta / 100).toFixed(2)}`}
                        </td>
                        <td className="px-2 py-1 text-[10px] text-slate-500">
                          {paid ? 'выплачено' : 'черновик'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {rows.some((r) => r.hints.length > 0) && (
            <ul className="space-y-0.5 text-[11px] text-slate-500">
              {rows
                .flatMap((r) =>
                  r.hints
                    .filter((h) => h.includes('Перенос') || h.includes('Период'))
                    .map((h) => `${r.performerName}: ${h}`),
                )
                .slice(0, 8)
                .map((h) => (
                  <li key={h}>· {h}</li>
                ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
