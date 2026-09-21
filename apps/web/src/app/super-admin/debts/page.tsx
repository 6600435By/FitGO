'use client';

import type { SpecialistServiceDebt } from '@fitgo/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

/** Local calendar date YYYY-MM-DD (not UTC). */
function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00`);
  const b = Date.parse(`${to}T00:00:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / (24 * 60 * 60 * 1000)) + 1;
}

type PaymentFilter = 'ALL' | 'DEBT' | 'PAID';
type ReportMode = 'day' | 'period';

type Performer = { employeeCode: string; name: string; roles: string[] };

const MAX_DAYS = 31;

export default function SpecialistDebtsPage() {
  const todayIso = useMemo(() => isoDate(new Date()), []);

  const [mode, setMode] = useState<ReportMode>('day');
  const [day, setDay] = useState(todayIso);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return isoDate(d);
  });
  const [to, setTo] = useState(todayIso);
  const [employeeCode, setEmployeeCode] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [performers, setPerformers] = useState<Performer[]>([]);
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('ALL');
  const [rows, setRows] = useState<SpecialistServiceDebt[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api
      .superAdminSpecialistDebtPerformers(token)
      .then(setPerformers)
      .catch(() => setPerformers([]));
  }, []);

  const resolvedCode =
    employeeCode === '__manual__' ? manualCode.trim() : employeeCode.trim();

  const range = useMemo(() => {
    if (mode === 'day') return { from: day, to: day };
    return { from, to };
  }, [mode, day, from, to]);

  const periodDays = daysInclusive(range.from, range.to);
  const periodOk =
    periodDays >= 1 && periodDays <= MAX_DAYS && range.to >= range.from;

  const load = () => {
    const token = getToken();
    if (!token) {
      setMessage('Нет сессии — войдите снова');
      return;
    }
    if (!resolvedCode) {
      setMessage('Выберите специалиста — отчёт только по одному сотруднику');
      return;
    }
    if (!periodOk) {
      setMessage(
        periodDays > MAX_DAYS
          ? `Период не больше ${MAX_DAYS} дней (сейчас ${periodDays})`
          : 'Проверьте даты периода',
      );
      return;
    }
    setLoading(true);
    setMessage('');
    api
      .superAdminSpecialistDebts(token, {
        from: range.from,
        to: range.to,
        employeeCode: resolvedCode,
      })
      .then(setRows)
      .catch((err) => {
        setRows([]);
        setMessage(err.message || 'Ошибка загрузки');
      })
      .finally(() => setLoading(false));
  };

  const visible = useMemo(() => {
    if (paymentFilter === 'ALL') return rows;
    return rows.filter((r) => r.paymentStatus === paymentFilter);
  }, [rows, paymentFilter]);

  const debtRows = visible.filter((r) => r.paymentStatus === 'DEBT');
  const paidRows = visible.filter((r) => r.paymentStatus === 'PAID');
  const totalDebt = debtRows.reduce((sum, r) => sum + (r.amount || 0), 0);
  const totalPaid = paidRows.reduce((sum, r) => sum + (r.amount || 0), 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Услуги по специалистам</h1>
      <p className="text-sm text-slate-400">
        Отчёт из 1С только по одному сотруднику. Варианты: один день или любой
        период до {MAX_DAYS} дней — без выгрузки по всему клубу.
      </p>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="text-sm">
          Специалист
          <select
            className="input ml-1 min-w-[14rem]"
            value={employeeCode}
            onChange={(e) => setEmployeeCode(e.target.value)}
          >
            <option value="">— выберите —</option>
            {performers.map((p) => (
              <option key={p.employeeCode} value={p.employeeCode}>
                {p.name} ({p.employeeCode})
              </option>
            ))}
            <option value="__manual__">Другой код 1С…</option>
          </select>
        </label>
        {employeeCode === '__manual__' && (
          <label className="text-sm">
            Код 1С
            <input
              className="input ml-1"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="000000099"
            />
          </label>
        )}
        <fieldset className="flex gap-3 text-sm items-center border-0 p-0">
          <legend className="sr-only">Тип отчёта</legend>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="reportMode"
              checked={mode === 'day'}
              onChange={() => setMode('day')}
            />
            День
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="reportMode"
              checked={mode === 'period'}
              onChange={() => setMode('period')}
            />
            Период (≤{MAX_DAYS} дн.)
          </label>
        </fieldset>
        {mode === 'day' ? (
          <label className="text-sm">
            Дата
            <input
              type="date"
              className="input ml-1"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
        ) : (
          <>
            <label className="text-sm">
              С
              <input
                type="date"
                className="input ml-1"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="text-sm">
              По
              <input
                type="date"
                className="input ml-1"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <span
              className={`text-xs ${periodOk ? 'text-slate-400' : 'text-amber-300'}`}
            >
              {periodDays > 0 ? `${periodDays} дн.` : '—'}
            </span>
          </>
        )}
        <label className="text-sm">
          Оплата
          <select
            className="input ml-1"
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value as PaymentFilter)}
          >
            <option value="ALL">Все</option>
            <option value="DEBT">Долг</option>
            <option value="PAID">Оплачено</option>
          </select>
        </label>
        <button
          type="button"
          className="btn-primary"
          disabled={loading || !resolvedCode || !periodOk}
          onClick={load}
        >
          {loading ? 'Загрузка…' : 'Сформировать'}
        </button>
      </div>
      {message && <p className="text-sm text-red-400">{message}</p>}
      <p className="text-sm text-slate-300">
        Строк: {visible.length}
        {rows.length !== visible.length ? ` (из ${rows.length})` : ''}
        {debtRows.length > 0
          ? ` · долг ${totalDebt.toFixed(2)} ${rows[0]?.currency ?? ''}`
          : ''}
        {paidRows.length > 0
          ? ` · оплачено ${totalPaid.toFixed(2)} ${rows[0]?.currency ?? ''}`
          : ''}
      </p>
      {loading ? (
        <p className="text-slate-400">Загрузка из 1С…</p>
      ) : rows.length === 0 && !message ? (
        <p className="text-slate-400">
          Выберите специалиста и нажмите «Сформировать».
        </p>
      ) : visible.length === 0 ? (
        <p className="text-slate-400">Нет строк за период / фильтр.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-800">
                <th className="py-2 pr-2">Дата</th>
                <th className="py-2 pr-2">Клиент</th>
                <th className="py-2 pr-2">Услуга</th>
                <th className="py-2 pr-2">Специалист</th>
                <th className="py-2 pr-2">Сумма</th>
                <th className="py-2">Статус</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={`${r.docRef}-${r.occurredAt}-${r.employeeCode}`}
                  className="border-b border-slate-900"
                >
                  <td className="py-2 pr-2">{formatDateTime(r.occurredAt)}</td>
                  <td className="py-2 pr-2">{r.clientName}</td>
                  <td className="py-2 pr-2">{r.serviceName}</td>
                  <td className="py-2 pr-2">
                    {r.employeeName} ({r.employeeCode})
                  </td>
                  <td className="py-2 pr-2">
                    {r.amount} {r.currency}
                  </td>
                  <td
                    className={
                      r.paymentStatus === 'PAID'
                        ? 'py-2 text-emerald-400'
                        : 'py-2 text-amber-300'
                    }
                  >
                    {r.paymentStatus === 'PAID' ? 'Оплачено' : 'Долг'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
