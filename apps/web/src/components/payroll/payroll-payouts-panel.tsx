'use client';

import type {
  PayrollPayoutKind,
  PayrollPayoutPreview,
  StaffPaySummary,
} from '@fitgo/shared-types';
import {
  advanceHalfRange,
  isPayoutOverTolerance,
  monthSettlementRange,
  parseMoneyToMinor,
  PAYOUT_OVERPAY_TOLERANCE_MINOR,
  resolvePayoutFormSplit,
} from '@fitgo/shared-types';
import { Banknote, Pencil } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PayrollFold } from '@/components/payroll/payroll-fold';
import { DateField } from '@/components/ui/date-field';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import {
  resolveViewFilters,
  usePersistViewMemory,
} from '@/lib/use-view-memory';
import { isIsoDay } from '@/lib/view-memory';

function money(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)}\u00a0${currency}`;
}

/** Gap between «к выплате» and card+cash typed for this wave. */
function remainderHint(
  payableMinor: number,
  cardMinor: number,
  cashMinor: number,
): string | null {
  const gap = payableMinor - (cardMinor + cashMinor);
  if (gap === 0) return null;
  if (gap > 0) {
    return `останется перенос +${(gap / 100).toFixed(2)}`;
  }
  return `переплата ${(Math.abs(gap) / 100).toFixed(2)}`;
}

/** Fact advance paid (card+cash), not accrued totalMinor. */
function AdvancePaidCell({
  row,
  currency,
}: {
  row: PayrollPayoutPreview;
  currency: string;
}) {
  const paid = row.priorAdvancePaidMinor ?? 0;
  if (!paid && !row.priorAdvanceCardMinor && !row.priorAdvanceCashMinor) {
    return <span className="text-slate-500">—</span>;
  }
  return (
    <div className="leading-tight">
      <p className="tabular-nums text-sky-200/90">
        {money(paid, currency)}
      </p>
      <p className="mt-0.5 text-[10px] tabular-nums text-slate-500">
        карта {money(row.priorAdvanceCardMinor ?? 0, currency)}
      </p>
      <p className="text-[10px] tabular-nums text-slate-500">
        касса {money(row.priorAdvanceCashMinor ?? 0, currency)}
      </p>
    </div>
  );
}

/** Visible payout row status: draft / saved / paid. */
function PayoutStatusBadge({
  paid,
  saved,
}: {
  paid: boolean;
  saved: boolean;
}) {
  if (paid) {
    return (
      <span
        className="inline-flex items-center rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-300"
        title="Выплата подтверждена — правка только через «Изменить»"
      >
        Выплачено
      </span>
    );
  }
  if (saved) {
    return (
      <span
        className="inline-flex items-center rounded-md border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-sky-300"
        title="Черновик сохранён на сервере, ещё не подтверждён"
      >
        Сохранено
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-200"
      title="Суммы ещё не сохранены / не подтверждены"
    >
      Черновик
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

type RowDraft = {
  card: string;
  cash: string;
  selected: boolean;
  /** Quick fine amount (BYN), applied as negative adjustment. */
  fine: string;
  /** Quick bonus amount (BYN), applied as positive adjustment. */
  bonus: string;
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
  /** Print checked rows for the current payout period. */
  onPrintSelected?: (
    userIds: string[],
    periodFrom: string,
    periodTo: string,
  ) => void;
  printBusy?: boolean;
  /**
   * Open «Отчёт по сотруднику» for this person.
   * Period: аванс → 1–15 of wave month; ЗП 15-го → full calendar month paid.
   */
  onOpenEmployeeReport?: (
    userId: string,
    periodFrom: string,
    periodTo: string,
  ) => void;
  /** After draft save / confirm / amend — refresh employee report «Выплачено». */
  onPayoutAmountsChanged?: (userId?: string) => void;
};

type PayoutViewMem = {
  payYear: number;
  payMonth: number;
  payKind: PayrollPayoutKind;
  periodFrom: string;
  periodTo: string;
  department: Dept;
  staffId: string;
};

const PAYOUT_DEPTS: Dept[] = [
  'ALL',
  'MANAGER',
  'ADMIN',
  'TRAINER',
  'SPECIALIST',
  'TECH',
  'EXTERNAL',
];

/** Report window for FIO deep-link: wave semantics, not free-form date edits. */
function employeeReportRange(
  kind: PayrollPayoutKind,
  year: number,
  month: number,
): { from: string; to: string } {
  return kind === 'ADVANCE_HALF'
    ? advanceHalfRange(year, month)
    : monthSettlementRange(year, month);
}

export function PayrollPayoutsPanel({
  staff,
  open,
  onToggle,
  onPrintSelected,
  printBusy = false,
  onOpenEmployeeReport,
  onPayoutAmountsChanged,
}: Props) {
  const today = useMemo(() => new Date(), []);
  const pathname = usePathname();
  const ownerId = getUser()?.id ?? '';

  const boot = useMemo(() => {
    const defaults: PayoutViewMem = {
      payYear: today.getFullYear(),
      payMonth: today.getMonth() + 1,
      payKind: 'ADVANCE_HALF',
      periodFrom: '',
      periodTo: '',
      department: 'ALL',
      staffId: '',
    };
    return resolveViewFilters<PayoutViewMem>({
      userId: ownerId,
      pathname,
      slot: 'payouts',
      search: new URLSearchParams(),
      urlKeys: [],
      fromUrl: () => ({}),
      defaults,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, []);

  const [payYear, setPayYear] = useState(() =>
    Number.isFinite(boot.payYear) ? boot.payYear : today.getFullYear(),
  );
  const [payMonth, setPayMonth] = useState(() =>
    Number.isFinite(boot.payMonth) && boot.payMonth >= 1 && boot.payMonth <= 12
      ? boot.payMonth
      : today.getMonth() + 1,
  );
  const [payKind, setPayKind] = useState<PayrollPayoutKind>(() =>
    boot.payKind === 'MONTH_SETTLEMENT' ? 'MONTH_SETTLEMENT' : 'ADVANCE_HALF',
  );
  const [periodFrom, setPeriodFrom] = useState(() =>
    isIsoDay(boot.periodFrom) ? boot.periodFrom : '',
  );
  const [periodTo, setPeriodTo] = useState(() =>
    isIsoDay(boot.periodTo) ? boot.periodTo : '',
  );
  const [department, setDepartment] = useState<Dept>(() =>
    typeof boot.department === 'string' &&
    PAYOUT_DEPTS.includes(boot.department)
      ? boot.department
      : 'ALL',
  );
  const [staffId, setStaffId] = useState(
    typeof boot.staffId === 'string' ? boot.staffId : '',
  );
  const [rows, setRows] = useState<PayrollPayoutPreview[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  /** PAID rows unlocked for intentional amend (card/cash). */
  const [editingPaid, setEditingPaid] = useState<Record<string, boolean>>({});
  /** Snapshot before edit — used by «Отмена». */
  const [paidEditBaseline, setPaidEditBaseline] = useState<
    Record<string, { card: string; cash: string }>
  >({});
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
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const persistRef = useRef<
    (
      userId: string,
      card: string,
      cash: string,
      ctx: PayoutCtx,
    ) => Promise<void>
  >(async () => {});
  const keepRestoredPeriod = useRef(
    isIsoDay(boot.periodFrom) && isIsoDay(boot.periodTo),
  );

  usePersistViewMemory<PayoutViewMem>({
    slot: 'payouts',
    data: {
      payYear,
      payMonth,
      payKind,
      periodFrom,
      periodTo,
      department,
      staffId,
    },
  });

  const defaultRange = useMemo(() => {
    return payKind === 'ADVANCE_HALF'
      ? advanceHalfRange(payYear, payMonth)
      : monthSettlementRange(payYear, payMonth);
  }, [payKind, payYear, payMonth]);

  useEffect(() => {
    loadSeq.current += 1;
    if (keepRestoredPeriod.current) {
      keepRestoredPeriod.current = false;
      setRows([]);
      draftsRef.current = {};
      setDrafts({});
      setEditingPaid({});
      setPaidEditBaseline({});
      return;
    }
    setPeriodFrom(defaultRange.from);
    setPeriodTo(defaultRange.to);
    setRows([]);
    draftsRef.current = {};
    setDrafts({});
    setEditingPaid({});
    setPaidEditBaseline({});
  }, [defaultRange.from, defaultRange.to]);

  const isPaidRow = (userId: string) =>
    rowsRef.current.find((r) => r.performerId === userId)?.existingPayout
      ?.status === 'PAID';

  const persistDraft = async (
    userId: string,
    card: string,
    cash: string,
    ctx: PayoutCtx,
  ) => {
    const token = getToken();
    if (!token) return;
    // PAID must never autosave — only explicit «Сохранить» (confirm amend).
    if (isPaidRow(userId)) return;
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
      onPayoutAmountsChanged?.(userId);
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
          s.track === 'CLUB' ||
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
        const prev = draftsRef.current[p.performerId];
        const cardN = parseMoneyToMinor(card || '0');
        const cashN = parseMoneyToMinor(cash || '0');
        // Never auto-check: accidental «Подтвердить» mass-marked drafts as PAID.
        next[p.performerId] = {
          card,
          cash,
          selected: false,
          fine: prev?.fine ?? '',
          bonus: prev?.bonus ?? '',
        };
      }
      draftsRef.current = next;
      setDrafts(next);
      setEditingPaid({});
      setPaidEditBaseline({});
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
      fine: '',
      bonus: '',
    };
    const next = { ...cur, ...patch };
    if (patch.card !== undefined && payableMinor !== undefined) {
      const card = parseMoneyToMinor(patch.card || '0');
      next.cash = ((payableMinor - card) / 100).toFixed(2);
    }
    const merged = { ...draftsRef.current, [userId]: next };
    draftsRef.current = merged;
    setDrafts(merged);
    // Autosave only drafts / new rows. PAID: wait for «Сохранить».
    if (
      (patch.card !== undefined || patch.cash !== undefined) &&
      !isPaidRow(userId)
    ) {
      scheduleSave(userId, next.card, next.cash);
    }
  };

  const beginEditPaid = (userId: string) => {
    const d = draftsRef.current[userId];
    if (!d) return;
    setPaidEditBaseline((prev) => ({
      ...prev,
      [userId]: { card: d.card, cash: d.cash },
    }));
    setEditingPaid((prev) => ({ ...prev, [userId]: true }));
    setMessage('');
  };

  const cancelEditPaid = (userId: string) => {
    const pending = pendingSaves.current[userId];
    if (pending) {
      clearTimeout(pending.timer);
      delete pendingSaves.current[userId];
    }
    const baseline = paidEditBaseline[userId];
    const row = rowsRef.current.find((r) => r.performerId === userId);
    const card =
      baseline?.card ??
      (row?.existingPayout
        ? minorInput(row.existingPayout.cardTransferMinor)
        : draftsRef.current[userId]?.card ?? '0');
    const cash =
      baseline?.cash ??
      (row?.existingPayout
        ? minorInput(row.existingPayout.actualCashMinor)
        : draftsRef.current[userId]?.cash ?? '0');
    updateDraft(userId, { card, cash, selected: false });
    setEditingPaid((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    setPaidEditBaseline((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    setMessage('');
  };

  const saveEditPaid = async (userId: string) => {
    const token = getToken();
    if (!token) return;
    const row = rowsRef.current.find((r) => r.performerId === userId);
    const d = draftsRef.current[userId];
    if (!row || !d || row.existingPayout?.status !== 'PAID') return;
    const cardMinor = parseMoneyToMinor(d.card || '0');
    const cashMinor = parseMoneyToMinor(d.cash || '0');
    const paidTotal = cardMinor + cashMinor;
    if (isPayoutOverTolerance(row.payableMinor, paidTotal)) {
      setMessage(
        `${row.performerName}: карта+касса (${(paidTotal / 100).toFixed(2)}) больше «к выплате» (${(row.payableMinor / 100).toFixed(2)}) более чем на ${(PAYOUT_OVERPAY_TOLERANCE_MINOR / 100).toFixed(2)} BYN. Чтобы выдать больше — добавьте премию.`,
      );
      return;
    }
    if (
      !window.confirm(
        `Сохранить изменение выплаты для ${row.performerName}? Остаток переноса пересчитается.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await api.payrollPayoutConfirm(token, {
        userId,
        kind: payKind,
        year: payYear,
        month: payMonth,
        periodFrom: periodFrom || undefined,
        periodTo: periodTo || undefined,
        cardTransferMinor: cardMinor,
        actualCashMinor: cashMinor,
      });
      clearLocalDraft(ctxRef.current, userId);
      setEditingPaid((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      setPaidEditBaseline((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      setMessage(`Выплата изменена: ${row.performerName}`);
      await load();
      onPayoutAmountsChanged?.(userId);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Не удалось сохранить выплату');
    } finally {
      setBusy(false);
    }
  };

  const reopenToDraft = async (userId: string) => {
    const token = getToken();
    if (!token) return;
    const row = rowsRef.current.find((r) => r.performerId === userId);
    if (!row || row.existingPayout?.status !== 'PAID') return;
    if (
      !window.confirm(
        `Вернуть выплату ${row.performerName} в черновик? Статус снова «Сохранено», перенос восстановится как до подтверждения. Подтвердите снова, когда будете готовы.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await api.payrollPayoutReopenDraft(token, {
        userId,
        kind: payKind,
        year: payYear,
        month: payMonth,
        periodFrom: periodFrom || undefined,
        periodTo: periodTo || undefined,
      });
      setEditingPaid((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      setPaidEditBaseline((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      setMessage(`Возвращено в черновик: ${row.performerName}`);
      await load();
      onPayoutAmountsChanged?.(userId);
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : 'Не удалось вернуть в черновик',
      );
    } finally {
      setBusy(false);
    }
  };

  const applyQuickAdj = async (
    userId: string,
    kind: 'fine' | 'bonus',
  ) => {
    const token = getToken();
    if (!token) return;
    const d = draftsRef.current[userId];
    const raw = kind === 'fine' ? d?.fine : d?.bonus;
    const abs = Math.abs(parseMoneyToMinor(raw || '0'));
    if (!abs) {
      setMessage(kind === 'fine' ? 'Укажите сумму штрафа' : 'Укажите сумму премии');
      return;
    }
    if (!periodFrom || !periodTo) {
      setMessage('Сначала задайте период');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await api.payrollAdjustment(token, {
        userId,
        amountMinor: kind === 'fine' ? -abs : abs,
        reason: kind === 'fine' ? 'Штраф' : 'Премия',
        periodFrom,
        periodTo,
      });
      updateDraft(userId, kind === 'fine' ? { fine: '' } : { bonus: '' });
      setMessage(kind === 'fine' ? 'Штраф добавлен' : 'Премия добавлена');
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Не удалось добавить');
    } finally {
      setBusy(false);
    }
  };

  const confirmSelected = async () => {
    const token = getToken();
    if (!token) return;
    const selectedRows = rows.filter((r) => drafts[r.performerId]?.selected);
    const unpaidRows = selectedRows.filter(
      (r) => r.existingPayout?.status !== 'PAID',
    );
    const skippedPaid = selectedRows.length - unpaidRows.length;
    if (!unpaidRows.length) {
      setMessage(
        skippedPaid > 0
          ? 'Выплаченные строки не подтверждаются пакетом — откройте «Изменить» → «Сохранить» на строке.'
          : 'Нет выбранных строк для подтверждения',
      );
      return;
    }
    const overpayRow = unpaidRows.find((r) => {
      const d = drafts[r.performerId]!;
      const paid =
        parseMoneyToMinor(d.card || '0') + parseMoneyToMinor(d.cash || '0');
      return isPayoutOverTolerance(r.payableMinor, paid);
    });
    if (overpayRow) {
      const d = drafts[overpayRow.performerId]!;
      const paid =
        parseMoneyToMinor(d.card || '0') + parseMoneyToMinor(d.cash || '0');
      setMessage(
        `${overpayRow.performerName}: карта+касса (${(paid / 100).toFixed(2)}) больше «к выплате» (${(overpayRow.payableMinor / 100).toFixed(2)}) более чем на ${(PAYOUT_OVERPAY_TOLERANCE_MINOR / 100).toFixed(2)} BYN. Чтобы выдать больше — добавьте премию.`,
      );
      return;
    }
    const items = unpaidRows.map((r) => {
      const d = drafts[r.performerId]!;
      return {
        userId: r.performerId,
        cardTransferMinor: parseMoneyToMinor(d.card || '0'),
        actualCashMinor: parseMoneyToMinor(d.cash || '0'),
      };
    });
    const confirmMsg = `Подтвердить ${items.length} выплат(ы) за ${periodFrom}–${periodTo}?${
      skippedPaid > 0
        ? ` (пропущено выплаченных: ${skippedPaid} — правьте через «Изменить»)`
        : ''
    }`;
    if (!window.confirm(confirmMsg)) {
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
      setMessage(
        skippedPaid > 0
          ? `Подтверждено: ${items.length} (выплаченные пропущены: ${skippedPaid})`
          : `Подтверждено: ${items.length}`,
      );
      await load();
      onPayoutAmountsChanged?.();
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
    <PayrollFold
      open={open}
      onToggle={onToggle}
      title="Выплаты ЗП / Аванс"
      subtitle="Заработано и аванс по сотруднику, карта/касса, быстрые штраф и премия"
      icon={Banknote}
      badge={payKind === 'ADVANCE_HALF' ? '25 · аванс' : '15 · расчёт'}
    >
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
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-secondary px-3 py-1.5 text-sm"
                disabled={
                  busy ||
                  printBusy ||
                  !rows.some((r) => drafts[r.performerId]?.selected)
                }
                onClick={() => {
                  const ids = rows
                    .filter((r) => drafts[r.performerId]?.selected)
                    .map((r) => r.performerId);
                  if (!ids.length) {
                    setMessage('Отметьте сотрудников галочками в таблице');
                    return;
                  }
                  onPrintSelected?.(ids, periodFrom, periodTo);
                }}
                title={
                  !rows.some((r) => drafts[r.performerId]?.selected)
                    ? 'Отметьте сотрудников галочками в таблице'
                    : undefined
                }
              >
                {printBusy ? 'Печать…' : 'Печать'}
              </button>
              <button
                type="button"
                className="text-xs text-fitgo-300 hover:underline"
                disabled={!rows.length}
                onClick={() =>
                  setDrafts((prev) => {
                    const next = { ...prev };
                    for (const r of rows) {
                      const d = next[r.performerId];
                      if (!d) continue;
                      next[r.performerId] = { ...d, selected: true };
                    }
                    return next;
                  })
                }
              >
                Выбрать всех
              </button>
              <button
                type="button"
                className="text-xs text-slate-400 hover:underline"
                disabled={!rows.some((r) => drafts[r.performerId]?.selected)}
                onClick={() =>
                  setDrafts((prev) => {
                    const next = { ...prev };
                    for (const id of Object.keys(next)) {
                      const d = next[id];
                      if (!d) continue;
                      next[id] = { ...d, selected: false };
                    }
                    return next;
                  })
                }
              >
                Снять
              </button>
            </div>
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
            Черновики: карта/касса сохраняются автоматически. Статусы:{' '}
            <span className="text-amber-200">черновик</span>
            {' · '}
            <span className="text-sky-300">сохранено</span>
            {' · '}
            <span className="text-emerald-300">выплачено</span>
            . Уже выплаченные — «Изменить» → «Сохранить», либо «В черновик» если
            подтвердили по ошибке. Галочки не ставятся сами — отметьте вручную
            перед «Подтвердить выплаты».
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
            <>
              <p className="text-[11px] text-slate-500">
                {payKind === 'MONTH_SETTLEMENT'
                  ? 'К выплате = заработано − аванс (факт карта+касса) + перенос. Аванс — то, что уже выдали 25-го, не начисление.'
                  : 'Заработано — начисление волны 1–15; колонка Аванс пуста (это сама выплата 25-го). Перенос к авансу не применяется.'}
                {' '}
                Если карта+касса меньше «к выплате» — останется перенос на следующую выплату.
                Переплата больше {(PAYOUT_OVERPAY_TOLERANCE_MINOR / 100).toFixed(0)} BYN сверх «к выплате» запрещена — только через премию.
                {' '}
                Долг — личный долг сотрудника как клиента клуба (не вычитается из выплаты).
                {' '}
                ФИО → отчёт сотрудника (
                {payKind === 'ADVANCE_HALF' ? '1–15' : 'весь месяц'}
                ). Штраф / премия — в корректировки периода.
              </p>

              {/* Mobile / narrow: stacked cards */}
              <ul className="space-y-2 md:hidden">
                {rows.map((r) => {
                  const d = drafts[r.performerId] ?? {
                    card: '0',
                    cash: '0',
                    selected: false,
                    fine: '',
                    bonus: '',
                  };
                  const card = parseMoneyToMinor(d.card || '0');
                  const cash = parseMoneyToMinor(d.cash || '0');
                  const paid = r.existingPayout?.status === 'PAID';
                  const saved = r.existingPayout?.status === 'DRAFT';
                  const editing = Boolean(editingPaid[r.performerId]);
                  const paidLocked = paid && !editing;
                  const rem = remainderHint(r.payableMinor, card, cash);
                  return (
                    <li
                      key={r.performerId}
                      className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1"
                          disabled={busy}
                          title={
                            paid
                              ? 'Для печати / выбора. Пакетное подтверждение выплаченных недоступно — правьте через «Изменить»'
                              : undefined
                          }
                          checked={d.selected}
                          onChange={(e) =>
                            updateDraft(r.performerId, {
                              selected: e.target.checked,
                            })
                          }
                        />
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                            <button
                              type="button"
                              className="text-left font-medium text-sky-300 hover:text-sky-200 hover:underline"
                              title="Открыть отчёт по сотруднику за период волны"
                              onClick={() => {
                                const range = employeeReportRange(
                                  payKind,
                                  payYear,
                                  payMonth,
                                );
                                onOpenEmployeeReport?.(
                                  r.performerId,
                                  range.from,
                                  range.to,
                                );
                              }}
                            >
                              {r.performerName}
                              {r.usesFixedAdvance ? (
                                <span className="ml-1 text-[10px] text-fitgo-300 no-underline">
                                  фикс
                                </span>
                              ) : null}
                            </button>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <PayoutStatusBadge paid={paid} saved={saved} />
                              {paid && !editing ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn-secondary inline-flex items-center gap-1 px-2 py-0.5 text-[10px]"
                                    disabled={busy}
                                    title="Изменить карту/кассу выплаченной строки"
                                    onClick={() => beginEditPaid(r.performerId)}
                                  >
                                    <Pencil className="h-3 w-3" aria-hidden />
                                    Изменить
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-secondary px-2 py-0.5 text-[10px] text-amber-200"
                                    disabled={busy}
                                    title="Снять подтверждение — снова черновик"
                                    onClick={() =>
                                      void reopenToDraft(r.performerId)
                                    }
                                  >
                                    В черновик
                                  </button>
                                </>
                              ) : null}
                              {paid && editing ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn-primary px-2 py-0.5 text-[10px]"
                                    disabled={busy}
                                    onClick={() =>
                                      void saveEditPaid(r.performerId)
                                    }
                                  >
                                    Сохранить
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-secondary px-2 py-0.5 text-[10px]"
                                    disabled={busy}
                                    onClick={() =>
                                      cancelEditPaid(r.performerId)
                                    }
                                  >
                                    Отмена
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                            <div>
                              <p className="text-[10px] uppercase text-slate-500">
                                Долг
                              </p>
                              <p
                                className={`tabular-nums ${
                                  (r.staffDebtMinor ?? 0) > 0
                                    ? 'text-rose-300'
                                    : 'text-slate-500'
                                }`}
                              >
                                {(r.staffDebtMinor ?? 0) > 0
                                  ? money(r.staffDebtMinor, currency)
                                  : '—'}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase text-slate-500">
                                Заработано
                              </p>
                              <p className="tabular-nums text-slate-200">
                                {money(r.earnedMinor, currency)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase text-slate-500">
                                Аванс
                              </p>
                              <AdvancePaidCell row={r} currency={currency} />
                            </div>
                            <div>
                              <p className="text-[10px] uppercase text-slate-500">
                                К выплате
                              </p>
                              <p className="tabular-nums text-emerald-300">
                                {money(r.payableMinor, currency)}
                              </p>
                            </div>
                          </div>
                          {(r.carryInMinor !== 0 || rem) && (
                            <p className="text-[11px] text-slate-500">
                              {r.carryInMinor !== 0
                                ? `перенос ${money(r.carryInMinor, currency)}`
                                : null}
                              {r.carryInMinor !== 0 && rem ? ' · ' : null}
                              {rem ? (
                                <span className="text-amber-300/90">{rem}</span>
                              ) : null}
                            </p>
                          )}
                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-[10px] uppercase text-slate-500">
                              Карта
                              <input
                                className={`input mt-1 w-full py-1.5 text-sm ${
                                  paidLocked ? 'opacity-70' : ''
                                }`}
                                disabled={busy || paidLocked}
                                readOnly={paidLocked}
                                inputMode="decimal"
                                value={d.card}
                                onChange={(e) =>
                                  updateDraft(
                                    r.performerId,
                                    { card: e.target.value },
                                    r.payableMinor,
                                  )
                                }
                                onBlur={() => {
                                  if (!paidLocked) flushDraft(r.performerId);
                                }}
                              />
                            </label>
                            <label className="text-[10px] uppercase text-slate-500">
                              Из кассы
                              <input
                                className={`input mt-1 w-full py-1.5 text-sm ${
                                  paidLocked ? 'opacity-70' : ''
                                }`}
                                disabled={busy || paidLocked}
                                readOnly={paidLocked}
                                inputMode="decimal"
                                value={d.cash}
                                onChange={(e) =>
                                  updateDraft(r.performerId, {
                                    cash: e.target.value,
                                  })
                                }
                                onBlur={() => {
                                  if (!paidLocked) flushDraft(r.performerId);
                                }}
                              />
                            </label>
                          </div>
                          <div className="grid grid-cols-2 gap-2 border-t border-slate-800/80 pt-2">
                            <div className="flex gap-1">
                              <input
                                className="input min-w-0 flex-1 py-1.5 text-sm"
                                placeholder="Штраф"
                                inputMode="decimal"
                                disabled={busy}
                                value={d.fine}
                                onChange={(e) =>
                                  updateDraft(r.performerId, {
                                    fine: e.target.value,
                                  })
                                }
                              />
                              <button
                                type="button"
                                className="btn-secondary shrink-0 px-2 py-1 text-xs text-red-200"
                                disabled={busy || !d.fine.trim()}
                                onClick={() =>
                                  void applyQuickAdj(r.performerId, 'fine')
                                }
                              >
                                −
                              </button>
                            </div>
                            <div className="flex gap-1">
                              <input
                                className="input min-w-0 flex-1 py-1.5 text-sm"
                                placeholder="Премия"
                                inputMode="decimal"
                                disabled={busy}
                                value={d.bonus}
                                onChange={(e) =>
                                  updateDraft(r.performerId, {
                                    bonus: e.target.value,
                                  })
                                }
                              />
                              <button
                                type="button"
                                className="btn-secondary shrink-0 px-2 py-1 text-xs text-emerald-200"
                                disabled={busy || !d.bonus.trim()}
                                onClick={() =>
                                  void applyQuickAdj(r.performerId, 'bonus')
                                }
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Desktop: compact table + quick adj under FIO */}
              <div className="hidden overflow-x-auto rounded-lg border border-slate-800 md:block">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-slate-900/90 text-[10px] uppercase text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5"> </th>
                      <th className="px-2 py-1.5">ФИО</th>
                      <th className="px-2 py-1.5">Долг</th>
                      <th className="px-2 py-1.5">Заработано</th>
                      <th className="px-2 py-1.5">Аванс</th>
                      <th className="px-2 py-1.5">К выплате</th>
                      <th className="px-2 py-1.5">Карта</th>
                      <th className="px-2 py-1.5">Из кассы</th>
                      <th className="px-2 py-1.5">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const d = drafts[r.performerId] ?? {
                        card: '0',
                        cash: '0',
                        selected: false,
                        fine: '',
                        bonus: '',
                      };
                      const card = parseMoneyToMinor(d.card || '0');
                      const cash = parseMoneyToMinor(d.cash || '0');
                      const paid = r.existingPayout?.status === 'PAID';
                      const saved = r.existingPayout?.status === 'DRAFT';
                      const editing = Boolean(editingPaid[r.performerId]);
                      const paidLocked = paid && !editing;
                      const rem = remainderHint(r.payableMinor, card, cash);
                      return (
                        <tr
                          key={r.performerId}
                          className="border-t border-slate-800/80 text-slate-200 align-top"
                        >
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              disabled={busy}
                              title={
                                paid
                                  ? 'Для печати / выбора. Пакетное подтверждение выплаченных недоступно — правьте через «Изменить»'
                                  : undefined
                              }
                              checked={d.selected}
                              onChange={(e) =>
                                updateDraft(r.performerId, {
                                  selected: e.target.checked,
                                })
                              }
                            />
                          </td>
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              className="text-left font-medium text-sky-300 hover:text-sky-200 hover:underline"
                              title="Открыть отчёт по сотруднику за период волны"
                              onClick={() => {
                                const range = employeeReportRange(
                                  payKind,
                                  payYear,
                                  payMonth,
                                );
                                onOpenEmployeeReport?.(
                                  r.performerId,
                                  range.from,
                                  range.to,
                                );
                              }}
                            >
                              {r.performerName}
                              {r.usesFixedAdvance ? (
                                <span className="ml-1 text-[10px] text-fitgo-300 no-underline">
                                  фикс
                                </span>
                              ) : null}
                            </button>
                            {(r.carryInMinor !== 0 || rem) && (
                              <p className="mt-0.5 text-[10px] text-slate-500">
                                {r.carryInMinor !== 0
                                  ? `перенос ${money(r.carryInMinor, currency)}`
                                  : null}
                                {r.carryInMinor !== 0 && rem ? ' · ' : null}
                                {rem ? (
                                  <span className="text-amber-300/90">{rem}</span>
                                ) : null}
                              </p>
                            )}
                            <div className="mt-1.5 flex flex-wrap items-center gap-1">
                              <input
                                className="input w-[4.5rem] py-1 text-[11px]"
                                placeholder="Штраф"
                                inputMode="decimal"
                                disabled={busy}
                                value={d.fine}
                                onChange={(e) =>
                                  updateDraft(r.performerId, {
                                    fine: e.target.value,
                                  })
                                }
                                aria-label={`Штраф ${r.performerName}`}
                              />
                              <button
                                type="button"
                                className="btn-secondary px-1.5 py-0.5 text-[10px] text-red-200"
                                disabled={busy || !d.fine.trim()}
                                title="Добавить штраф"
                                onClick={() =>
                                  void applyQuickAdj(r.performerId, 'fine')
                                }
                              >
                                −
                              </button>
                              <input
                                className="input w-[4.5rem] py-1 text-[11px]"
                                placeholder="Премия"
                                inputMode="decimal"
                                disabled={busy}
                                value={d.bonus}
                                onChange={(e) =>
                                  updateDraft(r.performerId, {
                                    bonus: e.target.value,
                                  })
                                }
                                aria-label={`Премия ${r.performerName}`}
                              />
                              <button
                                type="button"
                                className="btn-secondary px-1.5 py-0.5 text-[10px] text-emerald-200"
                                disabled={busy || !d.bonus.trim()}
                                title="Добавить премию"
                                onClick={() =>
                                  void applyQuickAdj(r.performerId, 'bonus')
                                }
                              >
                                +
                              </button>
                            </div>
                          </td>
                          <td
                            className={`px-2 py-2 tabular-nums ${
                              (r.staffDebtMinor ?? 0) > 0
                                ? 'font-medium text-rose-300'
                                : 'text-slate-500'
                            }`}
                            title={
                              (r.staffDebtMinor ?? 0) > 0
                                ? 'Личный долг сотрудника как клиента (не вычитается из выплаты)'
                                : undefined
                            }
                          >
                            {(r.staffDebtMinor ?? 0) > 0
                              ? money(r.staffDebtMinor, currency)
                              : '—'}
                          </td>
                          <td className="px-2 py-2 tabular-nums">
                            {money(r.earnedMinor, currency)}
                          </td>
                          <td className="px-2 py-2">
                            <AdvancePaidCell row={r} currency={currency} />
                          </td>
                          <td className="px-2 py-2 tabular-nums text-emerald-300">
                            {money(r.payableMinor, currency)}
                          </td>
                          <td className="px-2 py-2">
                            <input
                              className={`input w-20 py-1 text-xs ${
                                paidLocked ? 'opacity-70' : ''
                              }`}
                              disabled={busy || paidLocked}
                              readOnly={paidLocked}
                              inputMode="decimal"
                              value={d.card}
                              onChange={(e) =>
                                updateDraft(
                                  r.performerId,
                                  { card: e.target.value },
                                  r.payableMinor,
                                )
                              }
                              onBlur={() => {
                                if (!paidLocked) flushDraft(r.performerId);
                              }}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              className={`input w-20 py-1 text-xs ${
                                paidLocked ? 'opacity-70' : ''
                              }`}
                              disabled={busy || paidLocked}
                              readOnly={paidLocked}
                              inputMode="decimal"
                              value={d.cash}
                              onChange={(e) =>
                                updateDraft(r.performerId, {
                                  cash: e.target.value,
                                })
                              }
                              onBlur={() => {
                                if (!paidLocked) flushDraft(r.performerId);
                              }}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex flex-col items-start gap-1">
                              <PayoutStatusBadge paid={paid} saved={saved} />
                              {paid && !editing ? (
                                <div className="flex flex-wrap gap-1">
                                  <button
                                    type="button"
                                    className="btn-secondary inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px]"
                                    disabled={busy}
                                    title="Изменить карту/кассу выплаченной строки"
                                    onClick={() => beginEditPaid(r.performerId)}
                                  >
                                    <Pencil className="h-3 w-3" aria-hidden />
                                    Изменить
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-secondary px-1.5 py-0.5 text-[10px] text-amber-200"
                                    disabled={busy}
                                    title="Снять подтверждение — снова черновик"
                                    onClick={() =>
                                      void reopenToDraft(r.performerId)
                                    }
                                  >
                                    В черновик
                                  </button>
                                </div>
                              ) : null}
                              {paid && editing ? (
                                <div className="flex flex-wrap gap-1">
                                  <button
                                    type="button"
                                    className="btn-primary px-1.5 py-0.5 text-[10px]"
                                    disabled={busy}
                                    onClick={() =>
                                      void saveEditPaid(r.performerId)
                                    }
                                  >
                                    Сохранить
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-secondary px-1.5 py-0.5 text-[10px]"
                                    disabled={busy}
                                    onClick={() =>
                                      cancelEditPaid(r.performerId)
                                    }
                                  >
                                    Отмена
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-700 bg-slate-950/90 text-slate-200">
                      <td
                        colSpan={6}
                        className="px-2 py-2 font-medium uppercase tracking-wide text-slate-500"
                      >
                        Итого по листу
                      </td>
                      <td className="px-2 py-2 tabular-nums font-medium">
                        {money(payoutTotals.cardMinor, currency)}
                      </td>
                      <td className="px-2 py-2 tabular-nums font-medium">
                        {money(payoutTotals.cashMinor, currency)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
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
    </PayrollFold>
  );
}
