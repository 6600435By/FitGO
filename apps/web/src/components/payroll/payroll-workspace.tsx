'use client';

import type { PayrollPeriodSummary, StaffPaySummary } from '@fitgo/shared-types';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function money(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)}\u00a0${currency}`;
}

function bandDot(band: string) {
  if (band === 'GREEN') return 'bg-emerald-400';
  if (band === 'RED') return 'bg-red-400';
  return 'bg-amber-300';
}

const TRACK_HINT: Record<string, string> = {
  ADMIN: 'Часы + % абонементов + % доп. услуг + премии/штрафы',
  GROUP_TRAINER: 'Ставка за занятие при мин. кол-ве человек',
  SPA: '% от платных услуг + ставка за услуги из абонемента',
  PT: '% от оплаченных ПТ (ступени по объёму; подарки в счёт)',
};

type Props = {
  mode: 'super' | 'admin';
};

export function PayrollWorkspace({ mode }: Props) {
  const today = useMemo(() => new Date(), []);
  const [staff, setStaff] = useState<StaffPaySummary[]>([]);
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState(() => {
    const d = new Date(today);
    d.setDate(1);
    return isoDate(d);
  });
  const [to, setTo] = useState(isoDate(today));
  const [summary, setSummary] = useState<PayrollPeriodSummary | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const canEdit = mode === 'super';

  const selected = staff.find((s) => s.userId === userId);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const load =
      mode === 'super' ? api.payrollStaff(token) : api.adminPayrollStaff(token);
    load
      .then((list) => {
        setStaff(list);
        if (list[0]) setUserId(list[0].userId);
      })
      .catch((e) => setMessage(e.message || 'Ошибка загрузки сотрудников'));
  }, [mode]);

  const load = async () => {
    const token = getToken();
    if (!token || !userId) return;
    setLoading(true);
    setMessage('');
    try {
      const s =
        mode === 'super'
          ? await api.payrollSummary(token, { userId, from, to })
          : await api.adminPayrollSummary(token, { userId, from, to });
      setSummary(s);
    } catch (e) {
      setSummary(null);
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  const lock = async () => {
    if (!canEdit) return;
    const token = getToken();
    if (!token || !userId) return;
    try {
      const s = await api.payrollLock(token, { userId, from, to });
      setSummary(s);
      setMessage('Период зафиксирован');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка lock');
    }
  };

  const saveAdj = async () => {
    if (!canEdit) return;
    const token = getToken();
    if (!token || !userId || !adjReason.trim()) return;
    await api.payrollAdjustment(token, {
      userId,
      amountMinor: Math.round(Number(adjAmount || 0) * 100),
      reason: adjReason.trim(),
      periodFrom: from,
      periodTo: to,
    });
    setAdjAmount('');
    setAdjReason('');
    setMessage('Корректировка добавлена');
    await load();
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-8 md:max-w-none">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
            Расчёт ЗП
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-slate-400">
            {mode === 'admin'
              ? 'Ваш расчёт за период по проверенным работам. Ставки настраивает супер-админ.'
              : 'Итог за период по проверенным работам. Ставки и % — в Staff.'}
          </p>
        </div>
        {canEdit && (
          <Link
            href="/super-admin/staff"
            className="text-sm text-fitgo-400 hover:text-fitgo-300"
          >
            Staff → ставки
          </Link>
        )}
      </header>

      <section className="rounded-2xl border border-slate-800/80 bg-gradient-to-b from-slate-900/80 to-slate-950/80 p-4 shadow-lg shadow-black/20 md:p-5">
        <div
          className={
            canEdit
              ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_7.5rem_7.5rem_auto_auto] lg:items-end'
              : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_7.5rem_7.5rem_auto] lg:items-end'
          }
        >
          {canEdit ? (
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
              Сотрудник
              <select
                className="input mt-1.5 w-full"
                value={userId}
                onChange={(e) => {
                  setUserId(e.target.value);
                  setSummary(null);
                }}
              >
                {staff.map((s) => (
                  <option key={s.userId} value={s.userId}>
                    {s.name}
                    {s.track ? ` · ${s.track}` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5 sm:col-span-2 lg:col-span-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                Моя ЗП
              </p>
              <p className="mt-0.5 font-medium text-white">
                {selected?.name ?? '…'}
              </p>
            </div>
          )}
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            С
            <input
              type="date"
              className="input mt-1.5 w-full"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            По
            <input
              type="date"
              className="input mt-1.5 w-full"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-primary w-full lg:min-w-[7.5rem] lg:w-auto"
            disabled={loading || !userId}
            onClick={load}
          >
            {loading ? 'Считаем…' : 'Рассчитать'}
          </button>
          {canEdit && (
            <button
              type="button"
              className="btn-secondary w-full lg:w-auto"
              disabled={!summary?.canLock}
              onClick={lock}
              title={
                summary && !summary.canLock
                  ? `Открытых нестыковок: ${summary.openExceptions}`
                  : undefined
              }
            >
              Lock
            </button>
          )}
        </div>

        {selected && (
          <div className="mt-4 space-y-2 border-t border-slate-800/80 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              {selected.track && (
                <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-300">
                  {selected.track}
                </span>
              )}
              {canEdit && (
                <Link
                  href={`/super-admin/staff/${selected.userId}`}
                  className="text-xs text-fitgo-400 hover:underline"
                >
                  Изменить ставки
                </Link>
              )}
            </div>
            {selected.track && TRACK_HINT[selected.track] && (
              <p className="text-xs text-slate-500">
                {TRACK_HINT[selected.track]}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {selected.payChips.map((c) => (
                <span
                  key={c}
                  className="rounded-full border border-slate-700/80 bg-slate-900/80 px-2.5 py-0.5 text-xs text-slate-300"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {message && (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-200">
          {message}
        </p>
      )}

      {summary && (
        <>
          <section className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
            <Stat
              label="Оклад / база"
              value={money(summary.baseSalaryMinor, summary.currency)}
            />
            <Stat
              label="Мотивация"
              value={money(summary.motivationMinor, summary.currency)}
            />
            <Stat
              label="± Корректировки"
              value={money(summary.adjustmentsMinor, summary.currency)}
            />
            <Stat
              label="Итого"
              value={money(summary.totalMinor, summary.currency)}
              emphasize
            />
          </section>

          <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm">
            <span className="font-medium text-white">{summary.performerName}</span>
            <span
              className={
                summary.openExceptions ? 'text-amber-300' : 'text-emerald-400'
              }
            >
              нестыковок: {summary.openExceptions}
            </span>
            <span className="text-slate-500">
              GREEN {summary.greenCount} · RESOLVED {summary.resolvedCount}
            </span>
            {summary.locked && (
              <span className="rounded-full bg-fitgo-500/15 px-2 py-0.5 text-xs text-fitgo-300">
                LOCKED
              </span>
            )}
          </section>

          {summary.anomalyHints.length > 0 && (
            <ul className="space-y-1 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-200">
              {summary.anomalyHints.map((h) => (
                <li key={h}>· {h}</li>
              ))}
            </ul>
          )}

          {canEdit && (
            <section className="space-y-3 rounded-2xl border border-slate-800 p-4 md:flex md:items-end md:gap-3 md:space-y-0">
              <div className="md:flex-1 space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Премия / штраф
                </p>
                <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder="± BYN"
                    value={adjAmount}
                    onChange={(e) => setAdjAmount(e.target.value)}
                  />
                  <input
                    className="input"
                    placeholder="Причина"
                    value={adjReason}
                    onChange={(e) => setAdjReason(e.target.value)}
                  />
                </div>
              </div>
              <button
                type="button"
                className="btn-secondary w-full md:w-auto"
                onClick={saveAdj}
              >
                Добавить
              </button>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-slate-300">
              Работы за период ({summary.workUnits.length})
            </h2>

            <div className="space-y-2 md:hidden">
              {summary.workUnits.length === 0 ? (
                <p className="text-sm text-slate-500">Нет строк</p>
              ) : (
                summary.workUnits.map((u) => (
                  <article
                    key={`${u.kind}-${u.id}`}
                    className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-white">{u.title}</p>
                        <p className="text-xs text-slate-500">
                          {formatDateTime(u.occurredAt)}
                          {u.clientName ? ` · ${u.clientName}` : ''}
                        </p>
                      </div>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">
                        {u.kind}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                      <span>×{u.quantity}</span>
                      <span className="inline-flex items-center gap-1">
                        <i
                          className={`h-2 w-2 rounded-full ${bandDot(u.trustBand)}`}
                        />
                        {u.trustBand}
                      </span>
                      {u.isComplimentary && (
                        <span className="text-violet-300">подарок</span>
                      )}
                      <span
                        className={
                          u.payrollTrusted && !u.isComplimentary
                            ? 'text-emerald-400'
                            : 'text-slate-500'
                        }
                      >
                        {u.isComplimentary
                          ? 'в счёт'
                          : u.payrollTrusted
                            ? 'в ЗП'
                            : 'не в ЗП'}
                      </span>
                    </div>
                  </article>
                ))
              )}
            </div>

            <div className="hidden overflow-hidden rounded-2xl border border-slate-800 md:block">
              <table className="w-full text-sm">
                <thead className="bg-slate-950/80 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Когда</th>
                    <th className="px-4 py-3">Вид</th>
                    <th className="px-4 py-3">Услуга</th>
                    <th className="px-4 py-3">Кол-во</th>
                    <th className="px-4 py-3">Trust</th>
                    <th className="px-4 py-3">В ЗП</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.workUnits.map((u) => (
                    <tr
                      key={`${u.kind}-${u.id}`}
                      className="border-t border-slate-900/80"
                    >
                      <td className="px-4 py-2.5 text-slate-400">
                        {formatDateTime(u.occurredAt)}
                      </td>
                      <td className="px-4 py-2.5">{u.kind}</td>
                      <td className="px-4 py-2.5">
                        {u.title}
                        {u.isComplimentary ? (
                          <span className="ml-1 text-violet-300">· подарок</span>
                        ) : null}
                        {u.clientName ? (
                          <span className="text-slate-500"> · {u.clientName}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">{u.quantity}</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <i
                            className={`h-2 w-2 rounded-full ${bandDot(u.trustBand)}`}
                          />
                          {u.trustBand}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {u.isComplimentary ? (
                          <span className="text-violet-300">счёт</span>
                        ) : u.payrollTrusted ? (
                          <span className="text-emerald-400">да</span>
                        ) : (
                          <span className="text-slate-600">нет</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {!summary && !loading && (
        <div className="rounded-2xl border border-dashed border-slate-800 px-4 py-12 text-center">
          <p className="text-sm text-slate-400">
            Выберите сотрудника и период
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Затем нажмите «Рассчитать»
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-3 md:p-4 ${
        emphasize
          ? 'border-fitgo-500/40 bg-fitgo-500/10'
          : 'border-slate-800 bg-slate-950/50'
      }`}
    >
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500 md:text-xs">
        {label}
      </p>
      <p
        className={`mt-1 font-semibold tabular-nums ${
          emphasize
            ? 'text-lg text-fitgo-300 md:text-xl'
            : 'text-base text-white md:text-lg'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
