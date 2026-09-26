'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ClubRevenueDetailResponse,
  ClubRevenueLineDto,
  ClubRevenuePaymentMethod,
  ClubRevenueReportResponse,
} from '@fitgo/shared-types';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { DateField } from '@/components/admin-sales/date-field';

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

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
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
  const cashManuals = data.manualEntries.filter((m) => m.kind !== 'burn');

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

function DetailPanel({
  detail,
  onClose,
}: {
  detail: ClubRevenueDetailResponse;
  onClose: () => void;
}) {
  const line = detail.line;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
      <button
        type="button"
        className="flex-1 cursor-default"
        aria-label="Закрыть"
        onClick={onClose}
      />
      <aside className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-slate-800 bg-slate-950 p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Детали операции</h2>
            <p className="text-sm text-slate-400">{line.statusLabel}</p>
          </div>
          <button type="button" className="btn-secondary text-sm" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-slate-500">Клиент</dt>
            <dd>{line.clientName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Товар / услуга</dt>
            <dd>{line.productName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Сотрудник</dt>
            <dd>{employeeLabel(line.employeeName, line.employeeExternalId)}</dd>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-slate-500">Дата</dt>
              <dd>{fmtDate(line.occurredAt)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Оплата</dt>
              <dd>{fmtDate(line.paidAt)}</dd>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-slate-500">Продажа</dt>
              <dd>{money(line.saleAmountMinor)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Оплачено</dt>
              <dd>{money(line.paidAmountMinor)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Возврат</dt>
              <dd className="text-rose-300">{money(line.refundAmountMinor)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Способ</dt>
              <dd>{paymentLabel(line.paymentMethod)}</dd>
            </div>
          </div>
          <div>
            <dt className="mb-1 text-slate-500">Разбивка оплаты</dt>
            <dd className="space-y-1 rounded-lg bg-slate-900 p-3">
              <div className="flex justify-between">
                <span>Наличные</span>
                <span>{money(line.split.cashMinor)}</span>
              </div>
              <div className="flex justify-between">
                <span>Карта</span>
                <span>{money(line.split.cardMinor)}</span>
              </div>
              <div className="flex justify-between">
                <span>Безнал</span>
                <span>{money(line.split.cashlessMinor)}</span>
              </div>
              <div className="flex justify-between">
                <span>Лицевой счёт</span>
                <span>{money(line.split.personalAccountMinor)}</span>
              </div>
            </dd>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {line.countsTowardIncome ? (
              <span className="rounded-full bg-fitgo-500/15 px-2 py-1 text-fitgo-300">
                В приходе
              </span>
            ) : (
              <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-400">
                Не в приходе
              </span>
            )}
            {line.countsTowardMotivation ? (
              <span className="rounded-full bg-amber-500/15 px-2 py-1 text-amber-300">
                В мотивации
              </span>
            ) : null}
          </div>
        </dl>
        {detail.related.length > 0 ? (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-medium text-slate-300">
              Связанные строки документа
            </h3>
            <ul className="space-y-2 text-sm">
              {detail.related.map((r) => (
                <li
                  key={r.id}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2"
                >
                  <div className="font-medium">{r.statusLabel}</div>
                  <div className="text-slate-400">
                    {r.productName ?? '—'} · {money(r.amountMinor)}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>
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
  const bounds = useMemo(() => monthBounds(), []);
  const [from, setFrom] = useState(bounds.from);
  const [to, setTo] = useState(bounds.to);
  const [operationType, setOperationType] = useState('all');
  const [paymentMethod, setPaymentMethod] = useState('all');
  const [filterKey, setFilterKey] = useState('all');
  const [employeeExternalId, setEmployeeExternalId] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState<ClubRevenueReportResponse | null>(null);
  const [detail, setDetail] = useState<ClubRevenueDetailResponse | null>(null);
  const [error, setError] = useState('');
  const [syncMsg, setSyncMsg] = useState('');
  const [loading, setLoading] = useState(false);

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
      });
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [from, to, operationType, paymentMethod, employeeExternalId, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyFilter = (
    key: string,
    nextOp: string,
    nextPay: string,
  ) => {
    setFilterKey(key);
    setOperationType(nextOp);
    setPaymentMethod(nextPay);
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

  const syncNow = async () => {
    const token = getToken();
    if (!token) return;
    setSyncMsg('Синхронизация…');
    try {
      const r = await api.superAdminSalesSync(token);
      const cr = r.clubRevenue;
      setSyncMsg(
        cr
          ? `Обновлено: ${cr.upserted} строк (${cr.from}…${cr.to})`
          : 'Синхронизация завершена',
      );
      await load();
    } catch (e) {
      setSyncMsg('');
      setError(e instanceof Error ? e.message : 'Ошибка синхронизации');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Продажи клуба</h1>
          <p className="text-sm text-slate-400">
            Продажи · выручка · лицевые счета. Цифры в карточках — фильтры списка.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.lastSyncedAt ? (
            <span className="text-xs text-slate-500">
              Синк:{' '}
              {new Date(data.lastSyncedAt).toLocaleString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          ) : null}
          <button type="button" className="btn-secondary text-sm" onClick={() => void syncNow()}>
            Обновить из 1С
          </button>
        </div>
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
        <label className="min-w-0 text-sm">
          <span className="mb-1 block h-4 text-slate-400">Поиск</span>
          <input
            className="input"
            placeholder="Клиент или товар"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
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

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}
      {syncMsg ? <p className="text-sm text-slate-400">{syncMsg}</p> : null}
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
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-900/80 text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">Дата</th>
                <th className="px-3 py-2 font-medium">Клиент</th>
                <th className="px-3 py-2 font-medium">Операция</th>
                <th className="px-3 py-2 font-medium">Товар</th>
                <th className="px-3 py-2 font-medium">Сотрудник</th>
                <th className="px-3 py-2 font-medium">Оплата</th>
                <th className="px-3 py-2 font-medium text-right">Сумма</th>
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
          </table>
        </div>
      ) : null}

      {detail ? (
        <DetailPanel detail={detail} onClose={() => setDetail(null)} />
      ) : null}
    </div>
  );
}
