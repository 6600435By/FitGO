'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ClubRevenueDetailResponse,
  ClubRevenueLineDto,
  ClubRevenuePaymentMethod,
  ClubRevenueReportResponse,
} from '@fitgo/shared-types';
import { UserRole } from '@fitgo/shared-types';
import { AdminStickyTable } from '@/components/admin/admin-sticky-table';
import { SaleDetailDrawer } from '@/components/admin-sales/sale-detail-drawer';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import { DateField } from '@/components/ui/date-field';
import {
  hasExplicitQuery,
  resolveViewFilters,
  usePersistViewMemory,
} from '@/lib/use-view-memory';
import { isIsoDay } from '@/lib/view-memory';

const SALES_URL_KEYS = [
  'from',
  'to',
  'employee',
  'segment',
  'debtor',
  'q',
  'product',
  'productId',
  'op',
  'payment',
  'externalId',
] as const;

type SalesViewMem = {
  from: string;
  to: string;
  operationType: string;
  paymentMethod: string;
  employeeExternalId: string;
  segment: string;
  debtor: string;
  q: string;
  productId: string;
  productExact: boolean;
};

const SYSTEM_EMPLOYEE_ID = '__1c__';

function employeeLabel(name: string | null | undefined, id?: string | null): string {
  if (id === SYSTEM_EMPLOYEE_ID || name === '1С') return '1С';
  if (name?.trim()) return name.trim();
  return '1С';
}

function money(minor: number): string {
  return (minor / 100).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function monthBounds(d = new Date()): { from: string; to: string } {
  const y = d.getFullYear();
  const m = d.getMonth();
  const from = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

function paymentLabel(m: ClubRevenuePaymentMethod | string): string {
  switch (m) {
    case 'cash':
      return 'Наличные';
    case 'card':
      return 'Карта';
    case 'cashless':
      return 'Безнал';
    case 'personalAccount':
      return 'Лицевой счёт';
    case 'mixed':
      return 'Смешанная';
    default:
      return 'Не указан';
  }
}

const CLUB_TZ = 'Europe/Minsk';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: CLUB_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const OPERATION_CHIPS: { id: string; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'payment', label: 'Оплаты' },
  { id: 'unpaid', label: 'Долг' },
  { id: 'refund', label: 'Возвраты' },
  { id: 'personal_deposit', label: 'Взносы на ЛС (клиент)' },
  { id: 'personal_credit', label: 'ЛС по абонементу' },
  { id: 'personal_burn', label: 'Сгорание ЛС' },
];

const PAYMENT_CHIPS: { id: string; label: string }[] = [
  { id: 'all', label: 'Все оплаты' },
  { id: 'cash', label: 'Наличные' },
  { id: 'card', label: 'Карта' },
  { id: 'cashless', label: 'Безнал' },
  { id: 'personalAccount', label: 'Лицевой счёт' },
  { id: 'mixed', label: 'Смешанная' },
];

function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs transition ${
        active
          ? 'bg-fitgo-500/20 text-fitgo-300 ring-1 ring-fitgo-500/40'
          : 'bg-slate-800 text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  );
}

function MetricButton({
  label,
  valueMinor,
  tone,
  active,
  onClick,
}: {
  label: string;
  valueMinor: number;
  tone?: 'amber' | 'rose' | 'muted';
  active?: boolean;
  onClick: () => void;
}) {
  const toneCls =
    tone === 'amber'
      ? 'text-amber-300'
      : tone === 'rose'
        ? 'text-rose-300'
        : 'text-slate-200';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-md px-1 py-0.5 text-left text-xs transition hover:bg-slate-800/80 ${
        active ? 'ring-1 ring-fitgo-500/50 bg-fitgo-500/10' : ''
      }`}
    >
      <span className="text-slate-400">{label}</span>
      <span className={`font-medium tabular-nums ${toneCls}`}>
        {money(valueMinor)}
      </span>
    </button>
  );
}

function SummaryCards({
  data,
  filterKey,
  onFilter,
  onAddManual,
  onDeleteManual,
}: {
  data: ClubRevenueReportResponse;
  filterKey: string;
  onFilter: (key: string, operationType: string, paymentMethod: string) => void;
  onAddManual: (kind: 'corpo' | 'other') => void;
  onDeleteManual: (id: string) => void;
}) {
  const s = data.summary;
  const sales = s.sales;
  const revenue = s.revenue;
  const pa = s.personalAccount;
  const cashManuals = data.manualEntries;

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="card">
        <div className="text-xs text-slate-500">Сформированные продажи</div>
        <button
          type="button"
          className={`mt-1 text-left text-xl font-semibold tabular-nums transition hover:text-fitgo-300 ${
            filterKey === 'sales' ? 'text-fitgo-300' : ''
          }`}
          onClick={() => onFilter('sales', 'all', 'all')}
        >
          {money(sales.formedMinor)}
        </button>
        <div className="mt-2 space-y-0.5">
          <MetricButton
            label="Оплаченные"
            valueMinor={sales.paidMinor}
            active={filterKey === 'sales_paid'}
            onClick={() => onFilter('sales_paid', 'payment', 'all')}
          />
          <MetricButton
            label="Не оплаченные (долг)"
            valueMinor={sales.unpaidMinor}
            tone="amber"
            active={filterKey === 'sales_unpaid'}
            onClick={() => onFilter('sales_unpaid', 'unpaid', 'all')}
          />
          <MetricButton
            label="Возвраты"
            valueMinor={-sales.refundsMinor}
            tone="rose"
            active={filterKey === 'sales_refunds'}
            onClick={() => onFilter('sales_refunds', 'refund', 'all')}
          />
          <MetricButton
            label="Безнал"
            valueMinor={sales.cashlessMinor}
            active={filterKey === 'sales_cashless'}
            onClick={() => onFilter('sales_cashless', 'payment', 'cashless')}
          />
          <MetricButton
            label="Оплата с ЛС"
            valueMinor={sales.personalAccountPaidMinor}
            active={filterKey === 'sales_pa'}
            onClick={() =>
              onFilter('sales_pa', 'payment', 'personalAccount')
            }
          />
        </div>
      </div>

      <div className="card">
        <div className="text-xs text-slate-500">Выручка</div>
        <button
          type="button"
          className={`mt-1 text-left text-xl font-semibold tabular-nums text-fitgo-300 transition ${
            filterKey === 'revenue' ? 'underline' : ''
          }`}
          onClick={() => onFilter('revenue', 'payment', 'all')}
        >
          {money(revenue.totalMinor)}
        </button>
        <div className="mt-2 space-y-0.5">
          <MetricButton
            label="Наличные"
            valueMinor={revenue.cashMinor}
            active={filterKey === 'revenue_cash'}
            onClick={() => onFilter('revenue_cash', 'payment', 'cash')}
          />
          <MetricButton
            label="Карта"
            valueMinor={revenue.cardMinor}
            active={filterKey === 'revenue_card'}
            onClick={() => onFilter('revenue_card', 'payment', 'card')}
          />
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <MetricButton
                label="Корпо"
                valueMinor={revenue.corpoMinor}
                active={filterKey === 'revenue_corpo'}
                onClick={() => onFilter('revenue_corpo', 'all', 'all')}
              />
            </div>
            <button
              type="button"
              className="rounded px-1.5 text-xs text-fitgo-300 hover:bg-slate-800"
              title="Добавить корпо"
              onClick={() => onAddManual('corpo')}
            >
              +
            </button>
          </div>
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <MetricButton
                label="Прочие"
                valueMinor={revenue.otherMinor}
                active={filterKey === 'revenue_other'}
                onClick={() => onFilter('revenue_other', 'all', 'all')}
              />
            </div>
            <button
              type="button"
              className="rounded px-1.5 text-xs text-fitgo-300 hover:bg-slate-800"
              title="Добавить прочие"
              onClick={() => onAddManual('other')}
            >
              +
            </button>
          </div>
          <MetricButton
            label="Возвраты нал"
            valueMinor={-revenue.refundsCashMinor}
            tone="rose"
            active={filterKey === 'revenue_refunds_cash'}
            onClick={() =>
              onFilter('revenue_refunds_cash', 'refund', 'cash')
            }
          />
          <MetricButton
            label="Возвраты карта"
            valueMinor={-revenue.refundsCardMinor}
            tone="rose"
            active={filterKey === 'revenue_refunds_card'}
            onClick={() =>
              onFilter('revenue_refunds_card', 'refund', 'card')
            }
          />
        </div>
        {cashManuals.length > 0 ? (
          <ul className="mt-3 space-y-1 border-t border-slate-800 pt-2 text-[11px] text-slate-500">
            {cashManuals.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2">
                <span>
                  {m.kind === 'corpo' ? 'Корпо' : 'Прочие'} {m.entryDate}
                  {m.note ? ` · ${m.note}` : ''}
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-slate-300">
                    {money(m.amountMinor)}
                  </span>
                  <button
                    type="button"
                    className="text-rose-400 hover:underline"
                    onClick={() => onDeleteManual(m.id)}
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="card">
        <div className="text-xs text-slate-500">Лицевые счета</div>
        <div className="mt-2 space-y-0.5">
          <MetricButton
            label="Зачислено клиентом"
            valueMinor={pa.depositsMinor}
            active={filterKey === 'pa_deposits'}
            onClick={() =>
              onFilter('pa_deposits', 'personal_deposit', 'all')
            }
          />
          <MetricButton
            label="По абонементу"
            valueMinor={pa.creditsMinor}
            active={filterKey === 'pa_credits'}
            onClick={() => onFilter('pa_credits', 'personal_credit', 'all')}
          />
          <MetricButton
            label="Сгорание ЛС"
            valueMinor={-pa.burnsMinor}
            tone="rose"
            active={filterKey === 'pa_burns'}
            onClick={() => onFilter('pa_burns', 'personal_burn', 'all')}
          />
        </div>
      </div>
    </div>
  );
}

function amountForLine(line: ClubRevenueLineDto): number {
  if (line.operationType === 'personal_burn') return line.amountMinor;
  if (line.operationType === 'refund') return -Math.abs(line.refundAmountMinor || line.amountMinor);
  if (line.operationType === 'unpaid') return line.saleAmountMinor;
  if (line.paidAmountMinor) return line.paidAmountMinor;
  return line.amountMinor;
}

export function ClubRevenuePanel() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const sessionUser = getUser();
  const ownerId = sessionUser?.id ?? '';
  const canManagerRework = Boolean(
    sessionUser?.roles?.includes(UserRole.SUPER_ADMIN) ||
      sessionUser?.roles?.includes(UserRole.MANAGER),
  );
  const bounds = useMemo(() => monthBounds(), []);

  const boot = useMemo(() => {
    const defaults: SalesViewMem = {
      from: bounds.from,
      to: bounds.to,
      operationType: 'all',
      paymentMethod: 'all',
      employeeExternalId: '',
      segment: '',
      debtor: '',
      q: '',
      productId: '',
      productExact: false,
    };
    return resolveViewFilters<SalesViewMem>({
      userId: ownerId,
      pathname,
      slot: 'main',
      search,
      urlKeys: [...SALES_URL_KEYS],
      fromUrl: (s) => {
        const from = s.get('from');
        const to = s.get('to');
        const q = s.get('product') || s.get('q') || '';
        const productId = s.get('productId') || '';
        return {
          ...(isIsoDay(from) ? { from } : {}),
          ...(isIsoDay(to) ? { to } : {}),
          operationType: s.get('op') || 'all',
          paymentMethod: s.get('payment') || 'all',
          employeeExternalId: s.get('employee') || '',
          segment: s.get('segment') || '',
          debtor: s.get('debtor') || '',
          q,
          productId,
          productExact:
            s.get('productExact') === '1' ||
            s.get('productExact') === 'true' ||
            Boolean(productId.trim()),
        };
      },
      defaults,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, []);

  const [from, setFrom] = useState(boot.from);
  const [to, setTo] = useState(boot.to);
  const [operationType, setOperationType] = useState(boot.operationType || 'all');
  const [paymentMethod, setPaymentMethod] = useState(
    boot.paymentMethod || 'all',
  );
  const [filterKey, setFilterKey] = useState('all');
  const [employeeExternalId, setEmployeeExternalId] = useState(
    boot.employeeExternalId || '',
  );
  const [segment, setSegment] = useState(boot.segment || '');
  const [debtor, setDebtor] = useState(boot.debtor || '');
  const [qInput, setQInput] = useState(boot.q || '');
  const [q, setQ] = useState(boot.q || '');
  const [productId, setProductId] = useState(boot.productId || '');
  const [productExact, setProductExact] = useState(Boolean(boot.productExact));
  const [data, setData] = useState<ClubRevenueReportResponse | null>(null);
  const [detail, setDetail] = useState<ClubRevenueDetailResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  usePersistViewMemory<SalesViewMem>({
    data: {
      from,
      to,
      operationType,
      paymentMethod,
      employeeExternalId,
      segment,
      debtor,
      q,
      productId,
      productExact,
    },
  });

  // Stable: functional setters only — never close over filter state, so a
  // late URL→state apply cannot compare against a stale `operationType` etc.
  const applySalesQuery = useCallback((source: URLSearchParams) => {
    if (!hasExplicitQuery(source, [...SALES_URL_KEYS])) return;
    const nextFrom = source.get('from');
    const nextTo = source.get('to');
    const nextEmp = source.get('employee') || '';
    const nextSeg = source.get('segment') || '';
    const nextDebtor = source.get('debtor') || '';
    const nextQ = source.get('product') || source.get('q') || '';
    const nextProductId = source.get('productId') || '';
    const nextExact =
      source.get('productExact') === '1' ||
      source.get('productExact') === 'true' ||
      Boolean(nextProductId.trim());
    const drill = Boolean(
      nextQ.trim() ||
        (source.get('externalId') || '').trim() ||
        nextProductId.trim(),
    );
    const nextOp = drill ? source.get('op') || 'all' : source.get('op');
    const nextPay = drill
      ? source.get('payment') || 'all'
      : source.get('payment');
    if (nextFrom && isIsoDay(nextFrom)) {
      setFrom((prev) => (nextFrom !== prev ? nextFrom : prev));
    }
    if (nextTo && isIsoDay(nextTo)) {
      setTo((prev) => (nextTo !== prev ? nextTo : prev));
    }
    setEmployeeExternalId((prev) => (nextEmp !== prev ? nextEmp : prev));
    setSegment((prev) => (nextSeg !== prev ? nextSeg : prev));
    setDebtor((prev) => (nextDebtor !== prev ? nextDebtor : prev));
    setQ((prev) => (nextQ !== prev ? nextQ : prev));
    setQInput((prev) => (nextQ !== prev ? nextQ : prev));
    setProductId((prev) => (nextProductId !== prev ? nextProductId : prev));
    setProductExact((prev) => (nextExact !== prev ? nextExact : prev));
    if (nextOp) {
      setOperationType((prev) => (nextOp !== prev ? nextOp : prev));
    }
    if (nextPay) {
      setPaymentMethod((prev) => (nextPay !== prev ? nextPay : prev));
    }
  }, []);

  // Address bar is authoritative on arrival (табель / ЗП), even when
  // useSearchParams is still empty and view-memory already filled state.
  useEffect(() => {
    const live = new URLSearchParams(window.location.search);
    applySalesQuery(live);
    if (
      live.get('q')?.trim() ||
      live.get('externalId')?.trim() ||
      live.get('product')?.trim()
    ) {
      setFilterKey('all');
    }
  }, [applySalesQuery]);

  // Keep filters in sync when navigating here with query params (ЗП → Продажа).
  // Bare chip navigation must not wipe restored memory with empty query.
  // Depend on search only — never re-apply a still-stale address bar after
  // a chip click (that used to snap `op` back, e.g. personal_deposit).
  useEffect(() => {
    if (!hasExplicitQuery(search, [...SALES_URL_KEYS])) return;
    applySalesQuery(new URLSearchParams(search.toString()));
  }, [applySalesQuery, search]);

  const applySearch = useCallback(() => {
    const next = qInput.trim();
    if (next === q.trim()) return;
    setProductId('');
    setProductExact(false);
    setQ(next);
    if (qInput !== next) setQInput(next);
  }, [qInput, q]);

  // Track externalId without putting `search` in the state→URL effect deps
  // (that re-ran the writer against a lagging React searchParams snapshot).
  const externalIdRef = useRef(search.get('externalId')?.trim() || '');
  useEffect(() => {
    externalIdRef.current = search.get('externalId')?.trim() || '';
  }, [search]);

  useEffect(() => {
    const live = new URLSearchParams(window.location.search);
    if (hasExplicitQuery(live, [...SALES_URL_KEYS])) {
      const liveFrom = live.get('from');
      const liveTo = live.get('to');
      const liveQ = (live.get('product') || live.get('q') || '').trim();
      const liveEmp = live.get('employee') || '';
      const drifted =
        (isIsoDay(liveFrom) && liveFrom !== from) ||
        (isIsoDay(liveTo) && liveTo !== to) ||
        liveQ !== q.trim() ||
        liveEmp !== (employeeExternalId || '');
      // Deep-link still ahead of state — do not overwrite the address bar.
      if (drifted) return;
    }
    const next = new URLSearchParams();
    next.set('from', from);
    next.set('to', to);
    if (operationType && operationType !== 'all') next.set('op', operationType);
    if (paymentMethod && paymentMethod !== 'all')
      next.set('payment', paymentMethod);
    if (employeeExternalId) next.set('employee', employeeExternalId);
    if (segment) next.set('segment', segment);
    if (debtor) next.set('debtor', debtor);
    if (q.trim()) {
      next.set('q', q.trim());
      next.set('product', q.trim());
    }
    if (productId.trim()) next.set('productId', productId.trim());
    if (productExact && q.trim()) next.set('productExact', '1');
    // Preserve deep-link from ЗП so detail + list stay open after filter rewrite.
    const ext =
      externalIdRef.current || live.get('externalId')?.trim() || '';
    if (ext) next.set('externalId', ext);
    const qs = next.toString();
    const current = live.toString();
    if (qs !== current) {
      router.replace(`${pathname}?${qs}`);
    }
    // Compare/write against live address bar only — React `search` lags and
    // must not be an effect dep (re-entry against a stale snapshot).
  }, [
    from,
    to,
    operationType,
    paymentMethod,
    employeeExternalId,
    segment,
    debtor,
    q,
    productId,
    productExact,
    pathname,
    router,
  ]);

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.superAdminClubSales(token, {
        from,
        to,
        operationType,
        paymentMethod,
        employeeExternalId: employeeExternalId || undefined,
        q: q.trim() || undefined,
        productId: productId.trim() || undefined,
        productExact: productExact || undefined,
        segment: segment || undefined,
        debtor: debtor || undefined,
      });
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [
    from,
    to,
    operationType,
    paymentMethod,
    employeeExternalId,
    q,
    productId,
    productExact,
    segment,
    debtor,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  // Deep-link from ЗП / discrepancies: ?externalId=… opens sale detail
  // and aligns date/client filters so the row is visible in the list.
  useEffect(() => {
    const ext = search.get('externalId')?.trim();
    if (!ext) return;
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const d = await api.superAdminClubSaleDetail(token, ext);
        if (cancelled) return;
        setDetail(d);
        const saleDay = (d.line.paidAt || d.line.occurredAt || '').slice(
          0,
          10,
        );
        if (saleDay && (saleDay < from || saleDay > to)) {
          setFrom(saleDay);
          setTo(saleDay);
        }
        const client = d.line.clientName?.trim();
        if (client && client !== q) {
          setQ(client);
          setQInput(client);
        }
      } catch {
        /* ignore — list still useful */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fetch on externalId
  }, [search]);

  const applyFilter = (
    key: string,
    nextOp: string,
    nextPay: string,
  ) => {
    setFilterKey(key);
    setOperationType(nextOp);
    setPaymentMethod(nextPay);
    setSegment('');
    setDebtor('');
  };

  const addManual = async (kind: 'corpo' | 'other') => {
    const token = getToken();
    if (!token) return;
    const raw = window.prompt(
      kind === 'corpo'
        ? 'Сумма корпо (BYN), например 1500'
        : 'Сумма прочих (BYN)',
    );
    if (!raw) return;
    const amount = Number(String(raw).replace(',', '.').replace(/\s/g, ''));
    if (!Number.isFinite(amount) || amount === 0) {
      setError('Некорректная сумма');
      return;
    }
    const note = window.prompt('Комментарий (необязательно)') ?? undefined;
    try {
      await api.superAdminClubSalesManualAdd(token, {
        kind,
        amount: Math.abs(amount),
        entryDate: to,
        note: note || undefined,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения');
    }
  };

  const deleteManual = async (id: string) => {
    const token = getToken();
    if (!token) return;
    if (!window.confirm('Удалить ручную сумму?')) return;
    try {
      await api.superAdminClubSalesManualDelete(token, id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка удаления');
    }
  };

  const openDetail = async (id: string) => {
    const token = getToken();
    if (!token) return;
    try {
      const d = await api.superAdminClubSaleDetail(token, id);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка деталей');
    }
  };

  const exportXlsx = async () => {
    const token = getToken();
    if (!token) return;
    setExporting(true);
    setError('');
    try {
      const blob = await api.superAdminClubSalesXlsx(token, {
        from,
        to,
        operationType,
        paymentMethod,
        employeeExternalId: employeeExternalId || undefined,
        q: q.trim() || undefined,
        productId: productId.trim() || undefined,
        productExact: productExact || undefined,
        segment: segment || undefined,
        debtor: debtor || undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sales_${from}_${to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка Excel');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Продажи клуба</h1>
          <p className="mt-0.5 hidden text-sm text-slate-400 sm:block">
            Продажи · выручка · лицевые счета. Цифры в карточках — фильтры списка.
            Свежие дни — кнопка «Обновить из 1С» сверху страницы.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary shrink-0 px-3 py-2 text-sm"
          disabled={exporting || loading}
          onClick={() => void exportXlsx()}
        >
          {exporting ? 'Выгрузка…' : 'Выгрузка в Excel'}
        </button>
      </div>

      <div className="card grid grid-cols-1 items-end gap-3 sm:grid-cols-[auto_minmax(11rem,1fr)_minmax(11rem,1fr)]">
        <div className="flex items-end gap-2">
          <DateField
            label="С"
            value={from}
            onChange={setFrom}
            className="w-[10.75rem]"
          />
          <span className="mb-3 text-slate-600" aria-hidden>
            —
          </span>
          <DateField
            label="По"
            value={to}
            onChange={setTo}
            className="w-[10.75rem]"
          />
        </div>
        <label className="min-w-0 text-sm">
          <span className="mb-1 block h-4 text-slate-400">Сотрудник</span>
          <select
            className="input"
            value={employeeExternalId}
            onChange={(e) => setEmployeeExternalId(e.target.value)}
          >
            <option value="">Все</option>
            {(data?.employees ?? []).map((e) => (
              <option key={e.employeeExternalId} value={e.employeeExternalId}>
                {e.employeeName}
              </option>
            ))}
          </select>
        </label>
        <div className="min-w-0 text-sm">
          <span className="mb-1 block h-4 text-slate-400">Поиск</span>
          <div className="flex items-center gap-2">
            <input
              className="input min-w-0 flex-1"
              placeholder="Клиент или товар"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applySearch();
                }
              }}
            />
            <button
              type="button"
              className="btn-secondary h-11 shrink-0 px-3 py-0 text-sm"
              onClick={applySearch}
            >
              Найти
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {OPERATION_CHIPS.map((c) => (
          <Chip
            key={c.id}
            active={operationType === c.id}
            onClick={() => {
              setOperationType(c.id);
              setFilterKey(c.id === 'all' ? 'all' : c.id);
              if (c.id === 'unpaid') setPaymentMethod('all');
            }}
          >
            {c.label}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {PAYMENT_CHIPS.map((c) => (
          <Chip
            key={c.id}
            active={paymentMethod === c.id}
            onClick={() => setPaymentMethod(c.id)}
          >
            {c.label}
          </Chip>
        ))}
      </div>
      {(segment || debtor) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          {segment ? <span>Сегмент: {segment}</span> : null}
          {debtor ? (
            <span>
              Должник: {debtor === 'staff' ? 'сотрудники' : 'клиенты'}
            </span>
          ) : null}
          <button
            type="button"
            className="text-fitgo-400 hover:underline"
            onClick={() => {
              setSegment('');
              setDebtor('');
            }}
          >
            Сбросить
          </button>
        </div>
      )}

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}
      {loading && !data ? (
        <p className="text-sm text-slate-500">Загрузка…</p>
      ) : null}
      {data ? (
        <SummaryCards
          data={data}
          filterKey={filterKey}
          onFilter={applyFilter}
          onAddManual={(kind) => void addManual(kind)}
          onDeleteManual={(id) => void deleteManual(id)}
        />
      ) : null}

      {data ? (
        <AdminStickyTable>
            <thead className="bg-slate-900/80 text-xs font-medium text-slate-400">
              <tr>
                <th className="px-3 py-2">Дата</th>
                <th className="px-3 py-2">Клиент</th>
                <th className="px-3 py-2">Операция</th>
                <th className="px-3 py-2">Товар</th>
                <th className="px-3 py-2">Сотрудник</th>
                <th className="px-3 py-2">Оплата</th>
                <th className="px-3 py-2 text-right">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                    Нет строк за период
                  </td>
                </tr>
              ) : (
                data.lines.map((line) => {
                  const amt = amountForLine(line);
                  return (
                    <tr
                      key={line.id}
                      className="cursor-pointer border-t border-slate-800/80 hover:bg-slate-900/60"
                      onClick={() => void openDetail(line.id)}
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-slate-400">
                        {fmtDate(line.occurredAt)}
                      </td>
                      <td className="px-3 py-2">{line.clientName ?? '—'}</td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            line.operationType === 'unpaid'
                              ? 'text-amber-300'
                              : line.operationType === 'refund' ||
                                  line.operationType === 'personal_burn'
                                ? 'text-rose-300'
                                : ''
                          }
                        >
                          {line.statusLabel}
                        </span>
                      </td>
                      <td className="max-w-[14rem] truncate px-3 py-2 text-slate-300">
                        {line.productName ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-400">
                        {line.employeeExternalId === SYSTEM_EMPLOYEE_ID ||
                        line.employeeName === '1С' ? (
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs font-medium text-fitgo-300">
                            1С
                          </span>
                        ) : (
                          employeeLabel(line.employeeName, line.employeeExternalId)
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-400">
                        {paymentLabel(line.paymentMethod)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-medium ${
                          amt < 0 ? 'text-rose-300' : ''
                        }`}
                      >
                        {money(amt)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
        </AdminStickyTable>
      ) : null}

      {detail ? (
        <SaleDetailDrawer
          detail={detail}
          onClose={() => setDetail(null)}
          canRework={canManagerRework}
        />
      ) : null}
    </div>
  );
}
