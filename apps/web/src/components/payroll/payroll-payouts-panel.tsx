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
  resolvePayoutFormSplit,
} from '@fitgo/shared-types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DateField } from '@/components/ui/date-field';
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

type PayoutCtx = {
  payKind: PayrollPayoutKind;
  payYear: number;
  payMonth: number;
  periodFrom: string;
  periodTo: string;
};

type PendingSave = {
  timer: ReturnType<typeof setTimeout>;
  card: string;
  cash: string;
  ctx: PayoutCtx;
};

const DRAFT_PREFIX = 'fitgo.payrollPayoutDraft.v1';

function draftStorageKey(ctx: PayoutCtx, userId: string) {
  return `${DRAFT_PREFIX}|${ctx.payKind}|${ctx.periodFrom}|${ctx.periodTo}|${userId}`;
}

function readLocalDraft(
  ctx: PayoutCtx,
  userId: string,
): { card: string; cash: string; dirty: boolean } | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(draftStorageKey(ctx, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      card?: unknown;
      cash?: unknown;
      dirty?: unknown;
    };
    if (typeof parsed.card !== 'string' || typeof parsed.cash !== 'string') {
      return null;
    }
    return { card: parsed.card, cash: parsed.cash, dirty: parsed.dirty === true };
  } catch {
    return null;
  }
}

function writeLocalDraft(
  ctx: PayoutCtx,
  userId: string,
  card: string,
  cash: string,
  dirty: boolean,
) {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(
    draftStorageKey(ctx, userId),
    JSON.stringify({ card, cash, dirty }),
  );
}

function clearLocalDraft(ctx: PayoutCtx, userId: string) {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(draftStorageKey(ctx, userId));
}

function minorInput(minor: number) {
  return (minor / 100).toFixed(2);
}

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
  const ctxRef = useRef<PayoutCtx>({
    payKind,
    payYear,
    payMonth,
    periodFrom,
    periodTo,
  });
  ctxRef.current = { payKind, payYear, payMonth, periodFrom, periodTo };
  const pendingSaves = useRef<Record<string, PendingSave>>({});
  const saveSeq = useRef<Record<string, number>>({});
  const loadSeq = useRef(0);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const persistRef = useRef<
    (
      userId: string,
      card: string,
      cash: string,
      ctx: PayoutCtx,
    ) => Promise<void>
  >(async () => {});

  const defaultRange = useMemo(() => {
    return payKind === 'ADVANCE_HALF'
      ? advanceHalfRange(payYear, payMonth)
      : monthSettlementRange(payYear, payMonth);
  }, [payKind, payYear, payMonth]);

  useEffect(() => {
    loadSeq.current += 1;
    setPeriodFrom(defaultRange.from);
    setPeriodTo(defaultRange.to);
    setRows([]);
    draftsRef.current = {};
    setDrafts({});
  }, [defaultRange.from, defaultRange.to]);

  const persistDraft = async (
    userId: string,
    card: string,
    cash: string,
    ctx: PayoutCtx,
  ) => {
    const token = getToken();
    if (!token) return;
    const seq = (saveSeq.current[userId] ?? 0) + 1;
    saveSeq.current[userId] = seq;
    try {
      const dto = await api.payrollPayoutSaveDraft(token, {
        userId,
        kind: ctx.payKind,
        year: ctx.payYear,
        month: ctx.payMonth,
        periodFrom: ctx.periodFrom || undefined,
        periodTo: ctx.periodTo || undefined,
        cardTransferMinor: parseMoneyToMinor(card || '0'),
        actualCashMinor: parseMoneyToMinor(cash || '0'),
      });
      if (saveSeq.current[userId] !== seq) return;
      if (!pendingSaves.current[userId]) {
        writeLocalDraft(ctx, userId, card, cash, false);
      }
      const now = ctxRef.current;
      if (
        now.payKind !== ctx.payKind ||
        now.periodFrom !== ctx.periodFrom ||
        now.periodTo !== ctx.periodTo
      ) {
        return;
      }
      setRows((prev) =>
        prev.map((row) =>
          row.performerId === userId ? { ...row, existingPayout: dto } : row,
        ),
      );
    } catch (e) {
      if (saveSeq.current[userId] !== seq) return;
      setMessage(
        e instanceof Error ? e.message : 'Не удалось сохранить черновик',
      );
    }
  };
  persistRef.current = persistDraft;

  const scheduleSave = (
    userId: string,
    card: string,
    cash: string,
    ctxOverride?: PayoutCtx,
  ) => {
    const ctx = ctxOverride ?? { ...ctxRef.current };
    writeLocalDraft(ctx, userId, card, cash, true);
    const prev = pendingSaves.current[userId];
    if (prev) clearTimeout(prev.timer);
    const timer = setTimeout(() => {
      const pending = pendingSaves.current[userId];
      if (!pending || pending.timer !== timer) return;
      delete pendingSaves.current[userId];
      void persistRef.current(userId, pending.card, pending.cash, pending.ctx);
    }, 400);
    pendingSaves.current[userId] = { timer, card, cash, ctx };
  };

  const flushDraft = (userId: string) => {
    const pending = pendingSaves.current[userId];
    if (!pending) return;
    clearTimeout(pending.timer);
    delete pendingSaves.current[userId];
    void persistRef.current(userId, pending.card, pending.cash, pending.ctx);
  };

  const dropPendingSaves = () => {
    for (const item of Object.values(pendingSaves.current)) {
      clearTimeout(item.timer);
    }
    pendingSaves.current = {};
    for (const id of Object.keys(saveSeq.current)) {
      saveSeq.current[id] = (saveSeq.current[id] ?? 0) + 1;
    }
  };

  useEffect(() => {
    return () => {
      for (const [userId, item] of Object.entries(pendingSaves.current)) {
        clearTimeout(item.timer);
        void persistRef.current(userId, item.card, item.cash, item.ctx);
      }
      pendingSaves.current = {};
    };
  }, []);

  const filteredStaff = useMemo(() => {
    if (department === 'ALL') return staff;
    return staff.filter((s) => {
      if (department === 'EXTERNAL') return s.employmentKind === 'EXTERNAL';
      if (s.employmentKind === 'EXTERNAL') return false;
      if (department === 'MANAGER') {
        return s.roles.includes('MANAGER');
      }
      if (department === 'ADMIN') {
        return (
          (s.roles.includes('ADMIN') || s.track === 'ADMIN') &&
          !s.roles.includes('MANAGER')
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
    const seq = ++loadSeq.current;
    const ctx: PayoutCtx = {
      payKind,
      payYear,
      payMonth,
      periodFrom,
      periodTo,
    };
    setBusy(true);
    setMessage('');
    try {
      const list = await api.payrollPayoutBatchPreview(token, {
        kind: ctx.payKind,
        year: ctx.payYear,
        month: ctx.payMonth,
        periodFrom: ctx.periodFrom || undefined,
        periodTo: ctx.periodTo || undefined,
        department: staffId ? undefined : department,
        userIds: staffId ? [staffId] : undefined,
      });
      if (seq !== loadSeq.current) return;
      setRows(list);
      const next: Record<string, RowDraft> = {};
      for (const p of list) {
        const paid = p.existingPayout?.status === 'PAID';
        const split = resolvePayoutFormSplit({
          kind: ctx.payKind,
          payableMinor: p.payableMinor,
          fixedAdvanceMinor: p.fixedAdvanceMinor,
          saved: p.existingPayout
            ? {
                status: p.existingPayout.status,
                cardTransferMinor: p.existingPayout.cardTransferMinor,
                actualCashMinor: p.existingPayout.actualCashMinor,
              }
            : null,
        });
        let card = minorInput(split.cardMinor);
        let cash = minorInput(split.cashMinor);
        if (paid) {
          clearLocalDraft(ctx, p.performerId);
        } else {
          const local = readLocalDraft(ctx, p.performerId);
          const useLocal = Boolean(local && (local.dirty || !split.manual));
          if (local && useLocal) {
            card = local.card;
            cash = local.cash;
            scheduleSave(p.performerId, card, cash, ctx);
          }
        }
        next[p.performerId] = {
          card,
          cash,
          selected: !paid && p.payableMinor !== 0,
        };
      }
      draftsRef.current = next;
      setDrafts(next);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setRows([]);
      setMessage(e instanceof Error ? e.message : 'Ошибка превью');
    } finally {
      if (seq === loadSeq.current) setBusy(false);
    }
  };

  const updateDraft = (
    userId: string,
    patch: Partial<RowDraft>,
    payableMinor?: number,
  ) => {
    const cur = draftsRef.current[userId] ?? {
      card: '0',
      cash: '0',
      selected: false,
    };
    const next = { ...cur, ...patch };
    if (patch.card !== undefined && payableMinor !== undefined) {
      const card = parseMoneyToMinor(patch.card || '0');
      next.cash = ((payableMinor - card) / 100).toFixed(2);
    }
    const merged = { ...draftsRef.current, [userId]: next };
    draftsRef.current = merged;
    setDrafts(merged);
    if (patch.card !== undefined || patch.cash !== undefined) {
      scheduleSave(userId, next.card, next.cash);
    }
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
    dropPendingSaves();
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
      for (const item of items) {
        clearLocalDraft(ctxRef.current, item.userId);
      }
      setMessage(`Подтверждено: ${items.length}`);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка подтверждения');
    } finally {
      setBusy(false);
    }
  };

  const currency = rows[0]?.currency ?? 'BYN';

  const payoutTotals = useMemo(() => {
    let cardMinor = 0;
    let cashMinor = 0;
    for (const r of rows) {
      const d = drafts[r.performerId];
      cardMinor += parseMoneyToMinor(d?.card || '0');
      cashMinor += parseMoneyToMinor(d?.cash || '0');
    }
    return { cardMinor, cashMinor };
  }, [rows, drafts]);

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
            <DateField
              label="С"
              value={periodFrom}
              onChange={setPeriodFrom}
              className="w-[9.5rem]"
              inputClassName="text-sm"
            />
            <DateField
              label="По"
              value={periodTo}
              onChange={setPeriodTo}
              className="w-[9.5rem]"
              inputClassName="text-sm"
            />
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
          <p className="text-[11px] text-slate-500">
            Карта и касса, введённые вручную, сохраняются до подтверждения.
            После выплаты черновик снимается.
          </p>

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
                    const saved = r.existingPayout?.status === 'DRAFT';
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
                            onBlur={() => flushDraft(r.performerId)}
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
                            onBlur={() => flushDraft(r.performerId)}
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
                          {paid ? 'выплачено' : saved ? 'сохранено' : 'черновик'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-700 bg-slate-950/90 text-slate-200">
                    <td
                      colSpan={5}
                      className="px-2 py-2 font-medium uppercase tracking-wide text-slate-500"
                    >
                      Итого
                    </td>
                    <td className="px-2 py-2 tabular-nums font-medium">
                      {money(payoutTotals.cardMinor, currency)}
                    </td>
                    <td className="px-2 py-2 tabular-nums font-medium">
                      {money(payoutTotals.cashMinor, currency)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
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
