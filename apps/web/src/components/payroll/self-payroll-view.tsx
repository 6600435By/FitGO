'use client';

import type { PayrollSelfOverview, WorkUnit } from '@fitgo/shared-types';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { MotivationBreakdownList } from '@/components/payroll/motivation-breakdown-list';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function money(minor: number, currency = 'BYN') {
  return `${(minor / 100).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function payoutKindRu(kind: string) {
  return kind === 'ADVANCE_HALF' ? 'аванс' : 'расчёт';
}

function withQuery(
  base: string,
  params: Record<string, string | undefined>,
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) q.set(k, v);
  }
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

type Props = {
  /** Role surface for copy and 1C refresh mode. */
  role: 'admin' | 'trainer' | 'specialist';
};

export function SelfPayrollView({ role }: Props) {
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => {
    const d = new Date(today);
    d.setDate(1);
    return isoDate(d);
  });
  const [to, setTo] = useState(isoDate(today));
  const [data, setData] = useState<PayrollSelfOverview | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing1c, setSyncing1c] = useState(false);
  const [debtOpen, setDebtOpen] = useState(false);
  const [payoutsOpen, setPayoutsOpen] = useState(false);
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setMessage('');
    try {
      const overview = await api.selfPayrollOverview(token, { from, to });
      setData(overview);
    } catch (e) {
      setData(null);
      setMessage(e instanceof Error ? e.message : 'Ошибка расчёта');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  const refreshFrom1c = async () => {
    if (role !== 'admin') {
      await load();
      return;
    }
    const token = getToken();
    if (!token) return;
    setSyncing1c(true);
    setMessage('');
    try {
      const res = await api.classSyncRefreshForPayroll(
        token,
        { from, to },
        'admin',
      );
      setMessage(res.message);
      if (!res.periodLocked) {
        await load();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка обновления из 1С');
    } finally {
      setSyncing1c(false);
    }
  };

  const summary = data?.summary;
  const debt = data?.staffDebt;
  const currency = summary?.currency ?? 'BYN';
  const groupStats = summary?.groupStats;
  const trustedGroupUnits: WorkUnit[] = useMemo(
    () =>
      (summary?.workUnits ?? []).filter(
        (u) => u.kind === 'GROUP' && u.payrollTrusted,
      ),
    [summary?.workUnits],
  );
  const hasMotivationBreakdown =
    summary?.motivationBreakdown != null &&
    (summary.motivationBreakdown.membershipMinor > 0 ||
      summary.motivationBreakdown.spaMinor > 0 ||
      summary.motivationBreakdown.solariumMinor > 0 ||
      summary.motivationBreakdown.shopMinor > 0 ||
      summary.motivationBreakdown.corporateMinor > 0);

  const applyHalfMonth = (half: 'first' | 'second') => {
    const base = new Date(today);
    const y = base.getFullYear();
    const m = base.getMonth();
    if (half === 'first') {
      setFrom(isoDate(new Date(y, m, 1)));
      setTo(isoDate(new Date(y, m, 15)));
    } else {
      setFrom(isoDate(new Date(y, m, 16)));
      setTo(isoDate(new Date(y, m + 1, 0)));
    }
  };

  return (
    <div className="mx-auto w-full max-w-lg space-y-3 pb-8 md:max-w-2xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          {role === 'trainer' ? 'Моя ЗП' : 'Расчёт ЗП'}
        </h1>
        <p className="text-sm leading-relaxed text-slate-400">
          Ваш расчёт за период по проверенным работам. Ставки настраивает
          супер-админ.
        </p>
      </header>

      <section className="card space-y-3">
        {role === 'trainer' ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => applyHalfMonth('first')}
            >
              1–15
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => applyHalfMonth('second')}
            >
              16–конец месяца
            </button>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            С
            <input
              type="date"
              className="input mt-1 w-full py-1.5 text-sm"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            По
            <input
              type="date"
              className="input mt-1 w-full py-1.5 text-sm"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        <div
          className={
            role === 'admin'
              ? 'grid grid-cols-1 gap-2 sm:grid-cols-2'
              : 'grid grid-cols-1 gap-2'
          }
        >
          <button
            type="button"
            className="btn-primary w-full"
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? 'Считаем…' : 'Рассчитать'}
          </button>
          {role === 'admin' ? (
            <button
              type="button"
              className="btn-secondary w-full"
              disabled={syncing1c || loading}
              onClick={() => void refreshFrom1c()}
            >
              {syncing1c ? 'Обновляем…' : 'Обновить из 1С'}
            </button>
          ) : null}
        </div>
      </section>

      {message ? (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-200">
          {message}
        </p>
      ) : null}

      {!data && !loading ? (
        <div className="rounded-xl border border-dashed border-slate-700 px-4 py-10 text-center text-sm text-slate-500">
          <p>Выберите период</p>
          <p className="mt-1">Затем нажмите «Рассчитать»</p>
        </div>
      ) : null}

      {summary ? (
        <>
          <section className="card space-y-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                К выплате
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-white">
                {money(summary.totalMinor, currency)}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {summary.performerName}
                {summary.locked ? ' · период закрыт' : ''}
              </p>
            </div>
            <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
              <li className="rounded-lg bg-slate-900/70 px-3 py-2">
                <p className="text-[11px] text-slate-500">Оклад / часы</p>
                <p className="tabular-nums text-slate-200">
                  {money(summary.baseSalaryMinor, currency)}
                </p>
              </li>
              <li className="rounded-lg bg-slate-900/70 px-3 py-2">
                <p className="text-[11px] text-slate-500">Мотивация</p>
                <p className="tabular-nums text-slate-200">
                  {money(summary.motivationMinor, currency)}
                </p>
              </li>
              <li className="rounded-lg bg-slate-900/70 px-3 py-2">
                <p className="text-[11px] text-slate-500">Премии / штрафы</p>
                <p className="tabular-nums text-slate-200">
                  {money(summary.adjustmentsMinor, currency)}
                </p>
              </li>
            </ul>
            {hasMotivationBreakdown && summary.motivationBreakdown ? (
              <div className="border-t border-slate-800 pt-2">
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Из чего мотивация
                </p>
                <MotivationBreakdownList
                  breakdown={summary.motivationBreakdown}
                  sales={summary.sales}
                  currency={currency}
                />
              </div>
            ) : null}
            {groupStats ? (
              <ul className="grid grid-cols-2 gap-2 border-t border-slate-800 pt-2 text-sm">
                <li className="rounded-lg bg-slate-900/70 px-3 py-2">
                  <p className="text-[11px] text-slate-500">Занятий в ЗП</p>
                  <p className="tabular-nums text-slate-200">
                    {groupStats.classCount}
                  </p>
                </li>
                <li className="rounded-lg bg-slate-900/70 px-3 py-2">
                  <p className="text-[11px] text-slate-500">Среднее людей</p>
                  <p className="tabular-nums text-slate-200">
                    {groupStats.avgPeople.toLocaleString('ru-RU', {
                      maximumFractionDigits: 1,
                    })}
                  </p>
                </li>
              </ul>
            ) : null}
            {summary.ptStats ? (
              <ul className="grid grid-cols-2 gap-2 border-t border-slate-800 pt-2 text-sm">
                <li className="rounded-lg bg-slate-900/70 px-3 py-2">
                  <p className="text-[11px] text-slate-500">ПТ за период</p>
                  <p className="tabular-nums text-slate-200">
                    {summary.ptStats.sessionCount}
                  </p>
                </li>
                <li className="rounded-lg bg-slate-900/70 px-3 py-2">
                  <p className="text-[11px] text-slate-500">% по шкале</p>
                  <p className="tabular-nums text-slate-200">
                    {summary.ptStats.percent}%
                  </p>
                </li>
              </ul>
            ) : null}
            {summary.payChips.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {summary.payChips.map((c) => (
                  <span
                    key={c}
                    className="rounded-full border border-slate-700/80 bg-slate-900/80 px-2.5 py-0.5 text-xs text-slate-300"
                  >
                    {c}
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          {debt ? (
            <section className="card space-y-2">
              <button
                type="button"
                className="flex w-full items-start justify-between gap-2 text-left"
                onClick={() => setDebtOpen((v) => !v)}
              >
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Долг перед клубом
                  </p>
                  <p
                    className={`mt-1 text-xl font-semibold tabular-nums ${
                      debt.amountMinor > 0 ? 'text-rose-300' : 'text-slate-200'
                    }`}
                  >
                    {money(debt.amountMinor, debt.currency)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    по карточке клиента в 1С
                    {debt.source === 'cache' ? ' · кэш' : ''}
                    {debt.source === 'none' && debt.amountMinor === 0
                      ? ' · нет данных'
                      : ''}
                  </p>
                </div>
                <span className="text-slate-400">
                  {debtOpen ? '▾' : '▸'}
                </span>
              </button>
              {debtOpen && debt.lines.length > 0 ? (
                <ul className="max-h-56 space-y-1.5 overflow-y-auto border-t border-slate-800 pt-2 text-sm">
                  {debt.lines.map((line, i) => (
                    <li
                      key={`${line.occurredAt}-${i}`}
                      className="flex justify-between gap-2"
                    >
                      <span className="min-w-0 flex-1 text-slate-300">
                        <span className="text-slate-500">
                          {formatDateTime(line.occurredAt).slice(0, 10)}
                        </span>{' '}
                        · {line.productName}
                      </span>
                      <span className="shrink-0 tabular-nums text-rose-200">
                        {money(line.amountMinor, debt.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {debtOpen && debt.lines.length === 0 ? (
                <p className="border-t border-slate-800 pt-2 text-sm text-slate-500">
                  Строк долга нет
                </p>
              ) : null}
            </section>
          ) : null}

          {(data.unconfirmedCount > 0 ||
            data.unpaidCount > 0 ||
            (data.unpaidSalesMinor != null && data.unpaidSalesMinor > 0)) && (
            <section className="space-y-2">
              {data.unconfirmedCount > 0 ? (
                <Link
                  href={withQuery(data.links.bookingControl, {
                    from,
                    to,
                    needsReview: '1',
                  })}
                  className="block rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-100"
                >
                  Не подтверждено: {data.unconfirmedCount}{' '}
                  {role === 'trainer'
                    ? 'занятий'
                    : role === 'specialist'
                      ? 'услуг'
                      : 'занятий/услуг'}{' '}
                  →
                </Link>
              ) : null}
              {data.unpaidCount > 0 ? (
                <Link
                  href={withQuery(data.links.bookingControl, {
                    from,
                    to,
                    payment: 'DEBT',
                  })}
                  className="block rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-100"
                >
                  Не оплачено: {data.unpaidCount} занятий/услуг →
                </Link>
              ) : null}
              {data.links.sales &&
              data.unpaidSalesMinor != null &&
              data.unpaidSalesMinor > 0 ? (
                <Link
                  href={withQuery(data.links.sales, {
                    from,
                    to,
                    payment: 'unpaid',
                  })}
                  className="block rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-100"
                >
                  Неоплаченные продажи (как продавец):{' '}
                  {money(data.unpaidSalesMinor, currency)} →
                </Link>
              ) : null}
            </section>
          )}

          {data.payoutsInPeriod.length > 0 ? (
            <section className="card space-y-2">
              <button
                type="button"
                className="flex w-full items-start justify-between gap-2 text-left"
                onClick={() => setPayoutsOpen((v) => !v)}
              >
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Уже выплачено в периоде
                  </p>
                  <p className="mt-1 text-sm text-slate-300">
                    {data.payoutsInPeriod
                      .map((p) => {
                        const day = (p.paidAt ?? `${p.periodTo}T12:00:00`)
                          .slice(0, 10)
                          .split('-')
                          .reverse()
                          .slice(0, 2)
                          .join('.');
                        return `${day} ${payoutKindRu(p.kind)} ${money(p.totalMinor, p.currency)}`;
                      })
                      .join(' · ')}
                  </p>
                </div>
                <span className="text-slate-400">
                  {payoutsOpen ? '▾' : '▸'}
                </span>
              </button>
              {payoutsOpen ? (
                <ul className="space-y-2 border-t border-slate-800 pt-2 text-sm">
                  {data.payoutsInPeriod.map((p) => (
                    <li
                      key={p.id}
                      className="flex justify-between gap-2 text-slate-300"
                    >
                      <span>
                        {payoutKindRu(p.kind)} · {p.periodFrom}–{p.periodTo}
                        {p.paidAt
                          ? ` · ${formatDateTime(p.paidAt)}`
                          : ''}
                      </span>
                      <span className="tabular-nums text-emerald-300">
                        {money(p.totalMinor, p.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {groupStats ? (
            <section className="card space-y-2">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left"
                onClick={() => setGroupOpen((v) => !v)}
              >
                <div>
                  <p className="font-medium text-slate-200">Занятия в ЗП</p>
                  <p className="text-xs text-slate-500">
                    {trustedGroupUnits.length} групповых · ср.{' '}
                    {groupStats.avgPeople.toLocaleString('ru-RU', {
                      maximumFractionDigits: 1,
                    })}{' '}
                    чел.
                  </p>
                </div>
                <span className="text-slate-400">
                  {groupOpen ? '▾' : '▸'}
                </span>
              </button>
              {groupOpen ? (
                <ul className="max-h-72 space-y-1.5 overflow-y-auto border-t border-slate-800 pt-2 text-sm">
                  {trustedGroupUnits.length === 0 ? (
                    <li className="text-slate-500">
                      Нет подтверждённых занятий за период
                    </li>
                  ) : (
                    trustedGroupUnits.map((u) => (
                      <li
                        key={u.id}
                        className="flex justify-between gap-2 border-b border-slate-900/80 py-1.5"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="text-slate-500">
                            {formatDateTime(u.occurredAt).slice(0, 10)}
                          </span>{' '}
                          · {u.title}
                          {u.roomTitle ? (
                            <span className="text-slate-500">
                              {' '}
                              · {u.roomTitle}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 tabular-nums text-slate-300">
                          пришло {u.quantity}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </section>
          ) : null}

          <section className="card space-y-2">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => setUnitsOpen((v) => !v)}
            >
              <div>
                <p className="font-medium text-slate-200">Детализация работ</p>
                <p className="text-xs text-slate-500">
                  {summary.workUnits.length} единиц · GREEN{' '}
                  {summary.greenCount}
                </p>
              </div>
              <span className="text-slate-400">{unitsOpen ? '▾' : '▸'}</span>
            </button>
            {unitsOpen ? (
              <ul className="max-h-72 space-y-1.5 overflow-y-auto border-t border-slate-800 pt-2 text-sm">
                {summary.workUnits.length === 0 ? (
                  <li className="text-slate-500">Нет работ за период</li>
                ) : (
                  summary.workUnits.map((u) => (
                    <li
                      key={u.id}
                      className="flex justify-between gap-2 border-b border-slate-900/80 py-1.5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="text-slate-500">
                          {formatDateTime(u.occurredAt).slice(0, 10)}
                        </span>{' '}
                        · {u.title}
                        {!u.payrollTrusted ? (
                          <span className="ml-1 text-amber-300">· ждёт</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 tabular-nums text-slate-300">
                        {u.priceMinor != null
                          ? money(u.priceMinor, currency)
                          : `${u.quantity}`}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
