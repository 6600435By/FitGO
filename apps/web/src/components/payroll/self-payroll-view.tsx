'use client';

import type { PayrollSelfOverview, WorkUnit } from '@fitgo/shared-types';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MotivationBreakdownList } from '@/components/payroll/motivation-breakdown-list';
import { DateField } from '@/components/ui/date-field';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import {
  resolveViewFilters,
  usePersistViewMemory,
} from '@/lib/use-view-memory';
import {
  formatCalculatedAt,
  getPayrollSummaryCache,
  isIsoDay,
  setPayrollSummaryCache,
} from '@/lib/view-memory';
import { formatDateTime } from '@/lib/utils';

/** Local calendar day as YYYY-MM-DD (never UTC — avoids 1→30 / 16→15 in UTC+3). */
function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

/** Selected date window vs club pay halves. */
function periodSlice(
  from: string,
  to: string,
): 'firstHalf' | 'secondHalf' | 'range' {
  if (from.slice(0, 7) !== to.slice(0, 7)) return 'range';
  const fd = Number(from.slice(8, 10));
  const td = Number(to.slice(8, 10));
  const y = Number(from.slice(0, 4));
  const m = Number(from.slice(5, 7));
  const eom = new Date(y, m, 0).getDate();
  if (fd === 1 && td === 15) return 'firstHalf';
  if (fd === 16 && td === eom) return 'secondHalf';
  return 'range';
}

function formatIsoRangeRu(from: string, to: string) {
  const fmt = (iso: string) => {
    const [, m, d] = iso.split('-');
    return `${d}.${m}`;
  };
  return `${fmt(from)}–${fmt(to)}`;
}

function PayWaveBadge({ wave }: { wave?: WorkUnit['payWave'] }) {
  if (wave === 'ADVANCE') {
    return (
      <span className="ml-1 inline-flex shrink-0 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
        аванс
      </span>
    );
  }
  if (wave === 'SETTLEMENT') {
    return (
      <span className="ml-1 inline-flex shrink-0 rounded-md bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-300">
        ЗП
      </span>
    );
  }
  return null;
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

type SelfViewMem = {
  from: string;
  to: string;
};

export function SelfPayrollView({ role }: Props) {
  const today = useMemo(() => new Date(), []);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ownerId = getUser()?.id ?? '';
  const cacheMode = `self-${role}`;

  const boot = useMemo(() => {
    const d = new Date(today);
    d.setDate(1);
    const defaults: SelfViewMem = {
      from: isoDate(d),
      to: isoDate(today),
    };
    return resolveViewFilters<SelfViewMem>({
      userId: ownerId,
      pathname,
      slot: 'main',
      search: searchParams,
      urlKeys: ['from', 'to'],
      fromUrl: (s) => {
        const from = s.get('from');
        const to = s.get('to');
        return {
          ...(isIsoDay(from) ? { from } : {}),
          ...(isIsoDay(to) ? { to } : {}),
        };
      },
      defaults,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, []);

  const [from, setFrom] = useState(boot.from);
  const [to, setTo] = useState(boot.to);
  const [calculatedAt, setCalculatedAt] = useState<number | null>(null);
  const [data, setData] = useState<PayrollSelfOverview | null>(() => {
    if (!ownerId) return null;
    const hit = getPayrollSummaryCache<PayrollSelfOverview>(ownerId, {
      mode: cacheMode,
      userId: ownerId,
      from: boot.from,
      to: boot.to,
    });
    return hit?.summary ?? null;
  });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing1c, setSyncing1c] = useState(false);
  const [debtOpen, setDebtOpen] = useState(false);
  const [payoutsOpen, setPayoutsOpen] = useState(false);
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);

  useEffect(() => {
    if (!ownerId) return;
    const hit = getPayrollSummaryCache<PayrollSelfOverview>(ownerId, {
      mode: cacheMode,
      userId: ownerId,
      from: boot.from,
      to: boot.to,
    });
    if (hit) setCalculatedAt(hit.calculatedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once
  }, []);

  usePersistViewMemory<SelfViewMem>({
    data: { from, to },
    toSearchParams: (d) => {
      const q = new URLSearchParams();
      if (d.from) q.set('from', d.from);
      if (d.to) q.set('to', d.to);
      return q;
    },
  });

  const clearData = () => {
    setData(null);
    setCalculatedAt(null);
  };

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setMessage('');
    try {
      const overview = await api.selfPayrollOverview(token, { from, to });
      setData(overview);
      const at = Date.now();
      setCalculatedAt(at);
      if (ownerId) {
        setPayrollSummaryCache(
          ownerId,
          { mode: cacheMode, userId: ownerId, from, to },
          overview,
        );
      }
    } catch (e) {
      clearData();
      setMessage(e instanceof Error ? e.message : 'Ошибка расчёта');
    } finally {
      setLoading(false);
    }
  }, [from, to, ownerId, cacheMode]);

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
  const advance = data?.advance;
  const currency = summary?.currency ?? 'BYN';
  const groupStats = summary?.groupStats;
  const slice = useMemo(() => periodSlice(from, to), [from, to]);
  const showWaveTags = Boolean(advance?.eligible);

  /** Confirmed GROUP + reformer-hall / personal reformer PT for the sessions list. */
  const trustedSessionUnits: WorkUnit[] = useMemo(
    () =>
      (summary?.workUnits ?? []).filter((u) => {
        if (!u.payrollTrusted) return false;
        if (u.kind === 'GROUP') return true;
        if (u.kind !== 'PT') return false;
        return Boolean(u.isReformerPersonal || u.roomKey === 'REFORMER');
      }),
    [summary?.workUnits],
  );

  /** 1–15 + advance profile → only sessions that pay on the 25th. */
  const displayedSessionUnits = useMemo(() => {
    if (
      advance?.eligible &&
      advance.accruesFromSessions &&
      slice === 'firstHalf'
    ) {
      return trustedSessionUnits.filter((u) => u.payWave === 'ADVANCE');
    }
    return trustedSessionUnits;
  }, [advance, slice, trustedSessionUnits]);

  const displayedGroupUnits = useMemo(
    () => displayedSessionUnits.filter((u) => u.kind === 'GROUP'),
    [displayedSessionUnits],
  );
  const displayedReformerPtUnits = useMemo(
    () => displayedSessionUnits.filter((u) => u.kind === 'PT'),
    [displayedSessionUnits],
  );
  const sessionEarnSum = useMemo(
    () =>
      displayedSessionUnits.reduce((s, u) => s + (u.earnMinor ?? 0), 0),
    [displayedSessionUnits],
  );

  const sessionsSubtitle = useMemo(() => {
    const parts: string[] = [];
    if (
      slice === 'firstHalf' &&
      advance?.eligible &&
      advance.accruesFromSessions
    ) {
      parts.push('Только занятия в аванс 25-е');
    } else if (showWaveTags) {
      parts.push('Метки аванс / ЗП');
    }
    if (displayedGroupUnits.length > 0) {
      let g = `${displayedGroupUnits.length} групповых`;
      if (groupStats && slice !== 'firstHalf') {
        g += ` · ср. ${groupStats.avgPeople.toLocaleString('ru-RU', {
          maximumFractionDigits: 1,
        })} чел.`;
      }
      parts.push(g);
    }
    if (displayedReformerPtUnits.length > 0) {
      parts.push(`${displayedReformerPtUnits.length} инд. реформер`);
    }
    if (!displayedSessionUnits.length) {
      parts.push(
        advance?.eligible &&
          advance.accruesFromSessions &&
          slice === 'firstHalf'
          ? 'Нет занятий для аванса'
          : 'Нет подтверждённых',
      );
    }
    if (sessionEarnSum > 0) {
      parts.push(`начислено ${money(sessionEarnSum, currency)}`);
    }
    return parts.join(' · ');
  }, [
    advance,
    currency,
    displayedGroupUnits.length,
    displayedReformerPtUnits.length,
    displayedSessionUnits.length,
    groupStats,
    sessionEarnSum,
    showWaveTags,
    slice,
  ]);

  const hasMotivationBreakdown =
    summary?.motivationBreakdown != null &&
    (summary.motivationBreakdown.membershipMinor > 0 ||
      summary.motivationBreakdown.spaMinor > 0 ||
      summary.motivationBreakdown.solariumMinor > 0 ||
      summary.motivationBreakdown.shopMinor > 0 ||
      summary.motivationBreakdown.corporateMinor > 0);

  const firstHalfPreset = useMemo(() => {
    const y = today.getFullYear();
    const m = today.getMonth();
    return {
      from: isoDate(new Date(y, m, 1)),
      to: isoDate(new Date(y, m, 15)),
    };
  }, [today]);
  const secondHalfPreset = useMemo(() => {
    const y = today.getFullYear();
    const m = today.getMonth();
    return {
      from: isoDate(new Date(y, m, 16)),
      to: isoDate(new Date(y, m + 1, 0)),
    };
  }, [today]);

  const applyHalfMonth = (half: 'first' | 'second') => {
    clearData();
    if (half === 'first') {
      setFrom(firstHalfPreset.from);
      setTo(firstHalfPreset.to);
    } else {
      setFrom(secondHalfPreset.from);
      setTo(secondHalfPreset.to);
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
              className={
                from === firstHalfPreset.from && to === firstHalfPreset.to
                  ? 'btn-primary text-xs'
                  : 'btn-secondary text-xs'
              }
              onClick={() => applyHalfMonth('first')}
            >
              1–15
            </button>
            <button
              type="button"
              className={
                from === secondHalfPreset.from && to === secondHalfPreset.to
                  ? 'btn-primary text-xs'
                  : 'btn-secondary text-xs'
              }
              onClick={() => applyHalfMonth('second')}
            >
              16–конец месяца
            </button>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <DateField
            label="С"
            value={from}
            onChange={(v) => {
              setFrom(v);
              clearData();
            }}
            inputClassName="text-sm"
          />
          <DateField
            label="По"
            value={to}
            onChange={(v) => {
              setTo(v);
              clearData();
            }}
            inputClassName="text-sm"
          />
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
        {data && calculatedAt != null ? (
          <p className="text-[11px] text-slate-500">
            Расчёт на {formatCalculatedAt(calculatedAt)}. «Рассчитать»
            {role === 'admin' ? ' или «Обновить из 1С»' : ''} — пересчитать
            заново.
          </p>
        ) : null}
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

          {advance?.eligible ? (
            <section className="card space-y-3 border-emerald-500/20 bg-gradient-to-b from-emerald-500/5 to-transparent">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-400/90">
                  Аванс 25-е · {formatIsoRangeRu(advance.periodFrom, advance.periodTo)}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
                  {money(advance.earnedMinor, currency)}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  {advance.usesFixedAdvance
                    ? 'Фиксированная выплата на карту по профилю (занятия — в расчёт 15-го).'
                    : 'Начисление за занятия 1–15, которые входят в аванс (ГП без реформеров).'}
                </p>
              </div>
              <ul className="grid grid-cols-2 gap-2 text-sm">
                <li className="rounded-lg border border-emerald-500/20 bg-slate-900/60 px-3 py-2">
                  <p className="text-[11px] text-slate-500">На карту</p>
                  <p className="tabular-nums text-emerald-200">
                    {money(advance.cardMinor, currency)}
                  </p>
                </li>
                <li className="rounded-lg border border-slate-700/80 bg-slate-900/60 px-3 py-2">
                  <p className="text-[11px] text-slate-500">Из кассы</p>
                  <p className="tabular-nums text-slate-200">
                    {money(advance.cashMinor, currency)}
                  </p>
                </li>
              </ul>
              {advance.accruesFromSessions ? (
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-slate-800/80 pt-2 text-sm">
                  <p className="text-slate-400">
                    В аванс в выбранном периоде:{' '}
                    <span className="tabular-nums text-slate-200">
                      {advance.advanceUnitCount}
                    </span>{' '}
                    {advance.advanceUnitCount === 1
                      ? 'занятие'
                      : advance.advanceUnitCount < 5
                        ? 'занятия'
                        : 'занятий'}
                  </p>
                  {advance.advanceEarnMinor > 0 ? (
                    <p className="tabular-nums text-emerald-300">
                      {money(advance.advanceEarnMinor, currency)}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {advance.hints.length > 0 ? (
                <ul className="space-y-1 border-t border-slate-800/80 pt-2 text-xs text-slate-500">
                  {advance.hints.slice(0, 3).map((h) => (
                    <li key={h}>· {h}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

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

          {groupStats ||
          trustedSessionUnits.length > 0 ||
          (advance?.eligible && advance.accruesFromSessions) ? (
            <section className="card space-y-2">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left"
                onClick={() => setGroupOpen((v) => !v)}
              >
                <div>
                  <p className="font-medium text-slate-200">Занятия в ЗП</p>
                  <p className="text-xs text-slate-500">{sessionsSubtitle}</p>
                </div>
                <span className="text-slate-400">
                  {groupOpen ? '▾' : '▸'}
                </span>
              </button>
              {groupOpen ? (
                <ul className="max-h-72 space-y-1.5 overflow-y-auto border-t border-slate-800 pt-2 text-sm">
                  {displayedSessionUnits.length === 0 ? (
                    <li className="text-slate-500">
                      {advance?.eligible &&
                      !advance.accruesFromSessions &&
                      slice === 'firstHalf'
                        ? 'Аванс — фиксированная сумма на карту; занятия учитываются в расчёте 15-го'
                        : 'Нет подтверждённых занятий за период'}
                    </li>
                  ) : (
                    displayedSessionUnits.map((u) => (
                      <li
                        key={u.id}
                        className="flex justify-between gap-2 border-b border-slate-900/80 py-1.5"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="text-slate-500">
                            {formatDateTime(u.occurredAt).slice(0, 10)}
                          </span>{' '}
                          ·{' '}
                          <span className="text-slate-500">
                            {u.kind === 'PT' ? 'ПТ' : 'ГП'}
                          </span>{' '}
                          · {u.title}
                          {u.roomTitle ? (
                            <span className="text-slate-500">
                              {' '}
                              · {u.roomTitle}
                            </span>
                          ) : null}
                          {showWaveTags ? (
                            <PayWaveBadge wave={u.payWave} />
                          ) : null}
                        </span>
                        <span className="shrink-0 text-right tabular-nums text-slate-300">
                          {u.earnMinor != null && u.earnMinor > 0 ? (
                            <span className="block text-emerald-300">
                              {money(u.earnMinor, currency)}
                            </span>
                          ) : null}
                          <span
                            className={
                              u.earnMinor != null && u.earnMinor > 0
                                ? 'text-[11px] text-slate-500'
                                : undefined
                            }
                          >
                            {u.kind === 'PT'
                              ? u.priceMinor != null
                                ? money(u.priceMinor, currency)
                                : '1'
                              : `пришло ${u.quantity}`}
                          </span>
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
                  {showWaveTags ? ' · метки аванс / ЗП' : ''}
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
                        {showWaveTags ? (
                          <PayWaveBadge wave={u.payWave} />
                        ) : null}
                        {!u.payrollTrusted ? (
                          <span className="ml-1 text-amber-300">· ждёт</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-right tabular-nums text-slate-300">
                        {u.earnMinor != null && u.earnMinor > 0 ? (
                          <span className="block text-emerald-300">
                            {money(u.earnMinor, currency)}
                          </span>
                        ) : null}
                        <span
                          className={
                            u.earnMinor != null && u.earnMinor > 0
                              ? 'text-[11px] text-slate-500'
                              : undefined
                          }
                        >
                          {u.priceMinor != null
                            ? money(u.priceMinor, currency)
                            : `${u.quantity}`}
                        </span>
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
