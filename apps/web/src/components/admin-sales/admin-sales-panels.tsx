'use client';

import { useCallback, useEffect, useMemo, useState, Fragment } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import type {
  AdminMySalesResponse,
  AdminSaleLineDto,
  AdminSalePaymentFilter,
  AdminSaleType,
  AdminSalesOverviewResponse,
  AdminSalesStaffDetailResponse,
} from '@fitgo/shared-types';
import { AdminStickyTable } from '@/components/admin/admin-sticky-table';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import { DateField } from '@/components/ui/date-field';
import {
  resolveViewFilters,
  usePersistViewMemory,
} from '@/lib/use-view-memory';
import { isIsoDay } from '@/lib/view-memory';

function money(minor: number): string {
  return (minor / 100).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function saleTypeLabel(t: AdminSaleType): string {
  switch (t) {
    case 'membership':
      return 'Абонемент';
    case 'massage':
      return 'Массаж';
    case 'solarium':
      return 'Солярий';
    case 'shop':
      return 'Магазин';
  }
}

function monthBounds(d = new Date()): { from: string; to: string } {
  const y = d.getFullYear();
  const m = d.getMonth();
  const from = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

type SalesSegmentKey =
  | 'membership'
  | 'massage'
  | 'solarium'
  | 'shop'
  | 'unpaid'
  | 'accrual';

function TotalsBar({
  totals,
  attributionLabel,
  activeSegment,
  onSegmentClick,
}: {
  totals: AdminMySalesResponse['totals'];
  attributionLabel: string;
  activeSegment?: SalesSegmentKey | null;
  onSegmentClick?: (key: SalesSegmentKey) => void;
}) {
  const cell = (
    key: SalesSegmentKey,
    label: string,
    value: string,
    valueClass?: string,
  ) => {
    const active = activeSegment === key;
    const clickable = Boolean(onSegmentClick);
    const className = `rounded-xl px-2 py-1.5 text-left transition ${
      clickable ? 'hover:bg-slate-800/80' : ''
    } ${active ? 'bg-fitgo-500/15 ring-1 ring-fitgo-500/40' : ''}`;
    if (!clickable) {
      return (
        <div key={key} className={className}>
          <div className="text-slate-500">{label}</div>
          <div className={`font-semibold ${valueClass ?? ''}`}>{value}</div>
        </div>
      );
    }
    return (
      <button
        key={key}
        type="button"
        className={className}
        onClick={() => onSegmentClick?.(key)}
      >
        <div className="text-slate-500">{label}</div>
        <div className={`font-semibold ${valueClass ?? ''}`}>{value}</div>
      </button>
    );
  };

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-slate-400">Режим абонементов</span>
        <span className="rounded-full bg-slate-800 px-3 py-1 text-fitgo-300">
          {attributionLabel}
        </span>
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {cell('membership', 'Абонементы (оплачено)', money(totals.membershipPaidMinor))}
        {cell('massage', 'Массаж (оплачено)', money(totals.massagePaidMinor))}
        {cell('solarium', 'Солярий (оплачено)', money(totals.solariumPaidMinor))}
        {cell('shop', 'Магазин (оплачено)', money(totals.shopPaidMinor))}
        {cell(
          'unpaid',
          'Неоплачено (долг)',
          money(totals.unpaidMinor),
          'text-amber-300',
        )}
        {cell(
          'accrual',
          'К начислению',
          money(totals.accrualTotalMinor),
          'text-fitgo-300',
        )}
      </div>
      <div className="grid gap-1 border-t border-slate-800 pt-2 text-xs text-slate-400 sm:grid-cols-3">
        <span>Абонементы × %: {money(totals.accrualMembershipMinor)}</span>
        <span>Массаж/солярий × %: {money(totals.accrualExtraMinor)}</span>
        <span>Магазин × %: {money(totals.accrualShopMinor)}</span>
      </div>
    </div>
  );
}

function lineStatus(line: AdminSaleLineDto, overdueCutoff: number) {
  const unpaid = !line.paid;
  const soldAt = line.soldAt ? new Date(line.soldAt).getTime() : 0;
  const overdue = unpaid && soldAt > 0 && soldAt < overdueCutoff;
  return { unpaid, overdue };
}

function LinesTable({ lines }: { lines: AdminSaleLineDto[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!lines.length) {
    return (
      <p className="text-sm text-slate-500">Нет продаж за выбранный период</p>
    );
  }

  const overdueCutoff = Date.now() - 7 * 86400000;
  const groups = new Map<
    string,
    { key: string; name: string; lines: AdminSaleLineDto[]; totalMinor: number }
  >();
  for (const line of lines) {
    const name = line.clientName?.trim() || '—';
    const key = name.toLowerCase();
    const g = groups.get(key);
    if (g) {
      g.lines.push(line);
      g.totalMinor += line.attributedMinor;
    } else {
      groups.set(key, {
        key,
        name,
        lines: [line],
        totalMinor: line.attributedMinor,
      });
    }
  }
  const rows = [...groups.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'ru'),
  );

  return (
    <AdminStickyTable>
        <thead className="bg-slate-900/80 text-xs font-medium text-slate-400">
          <tr>
            <th className="px-3 py-2">Клиент</th>
            <th className="px-3 py-2 text-right">Продаж</th>
            <th className="px-3 py-2 text-right">Сумма</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((group) => {
            const open = expanded === group.key;
            return (
              <Fragment key={group.key}>
                <tr
                  className="cursor-pointer border-t border-slate-800 hover:bg-slate-900/60"
                  onClick={() =>
                    setExpanded(open ? null : group.key)
                  }
                >
                  <td className="px-3 py-2 font-medium">
                    <span className="mr-2 text-slate-500">{open ? '▾' : '▸'}</span>
                    {group.name}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-400">
                    {group.lines.length}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {money(group.totalMinor)}
                  </td>
                </tr>
                {open
                  ? group.lines.map((line) => {
                      const { overdue } = lineStatus(line, overdueCutoff);
                      return (
                        <tr
                          key={line.id}
                          className={`border-t border-slate-800/80 bg-slate-950/40 ${
                            overdue ? 'bg-amber-500/5' : ''
                          }`}
                        >
                          <td className="px-3 py-2 pl-8" colSpan={2}>
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                              <span>{saleTypeLabel(line.saleType)}</span>
                              <span className="text-xs text-slate-500">
                                {line.soldAt.slice(0, 10)}
                                {line.paidAt
                                  ? ` · опл. ${line.paidAt.slice(0, 10)}`
                                  : ''}
                              </span>
                              {line.productName ? (
                                <span className="text-xs text-slate-500">
                                  {line.productName}
                                </span>
                              ) : null}
                              {line.paid ? (
                                <span className="text-xs text-fitgo-300">
                                  Оплачена
                                </span>
                              ) : overdue ? (
                                <span className="text-xs text-amber-200">
                                  Долг &gt;7 дн.
                                </span>
                              ) : (
                                <span className="text-xs text-amber-300">
                                  Не оплачена
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-medium">
                            {money(line.attributedMinor)}
                          </td>
                        </tr>
                      );
                    })
                  : null}
              </Fragment>
            );
          })}
        </tbody>
    </AdminStickyTable>
  );
}

type AdminSalesViewMem = {
  from: string;
  to: string;
  payment: AdminSalePaymentFilter;
  saleType: AdminSaleType | 'all';
};

export function AdminMySalesPanel() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const ownerId = getUser()?.id ?? '';
  const bounds = useMemo(() => monthBounds(), []);

  const boot = useMemo(() => {
    const defaults: AdminSalesViewMem = {
      from: bounds.from,
      to: bounds.to,
      payment: 'all',
      saleType: 'all',
    };
    return resolveViewFilters<AdminSalesViewMem>({
      userId: ownerId,
      pathname,
      slot: 'main',
      search: searchParams,
      urlKeys: ['from', 'to', 'payment'],
      fromUrl: (s) => {
        const from = s.get('from')?.trim();
        const to = s.get('to')?.trim();
        const p = s.get('payment')?.trim()?.toLowerCase();
        return {
          ...(isIsoDay(from) ? { from } : {}),
          ...(isIsoDay(to) ? { to } : {}),
          payment:
            p === 'unpaid' || p === 'paid' || p === 'all' ? p : 'all',
        };
      },
      defaults,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, []);

  const [from, setFrom] = useState(boot.from);
  const [to, setTo] = useState(boot.to);
  const [saleType, setSaleType] = useState<AdminSaleType | 'all'>(
    boot.saleType === 'all' ||
      boot.saleType === 'membership' ||
      boot.saleType === 'massage' ||
      boot.saleType === 'solarium' ||
      boot.saleType === 'shop'
      ? boot.saleType
      : 'all',
  );
  const [payment, setPayment] = useState<AdminSalePaymentFilter>(() =>
    boot.payment === 'unpaid' || boot.payment === 'paid' || boot.payment === 'all'
      ? boot.payment
      : 'all',
  );
  const [activeSegment, setActiveSegment] = useState<SalesSegmentKey | null>(
    () => (boot.payment === 'unpaid' ? 'unpaid' : null),
  );
  const [listOpen, setListOpen] = useState(
    () => boot.payment === 'unpaid' || boot.payment === 'paid',
  );
  const [data, setData] = useState<AdminMySalesResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  usePersistViewMemory<AdminSalesViewMem>({
    data: { from, to, payment, saleType },
    toSearchParams: (d) => {
      const q = new URLSearchParams();
      if (d.from) q.set('from', d.from);
      if (d.to) q.set('to', d.to);
      if (d.payment && d.payment !== 'all') q.set('payment', d.payment);
      return q;
    },
  });

  const wantLines =
    listOpen || saleType !== 'all' || payment !== 'all' || Boolean(activeSegment);

  const load = useCallback(
    async (includeLines: boolean) => {
      const token = getToken();
      if (!token) return;
      setLoading(true);
      setError('');
      try {
        const res = await api.adminMySales(token, {
          from,
          to,
          saleType,
          payment,
          includeLines,
        });
        setData(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка загрузки');
      } finally {
        setLoading(false);
      }
    },
    [from, to, saleType, payment],
  );

  useEffect(() => {
    void load(wantLines);
  }, [load, wantLines]);

  const onSegmentClick = (key: SalesSegmentKey) => {
    if (activeSegment === key && listOpen) {
      setActiveSegment(null);
      setSaleType('all');
      setPayment('all');
      setListOpen(false);
      return;
    }
    setActiveSegment(key);
    setListOpen(true);
    if (key === 'unpaid') {
      setSaleType('all');
      setPayment('unpaid');
      return;
    }
    if (key === 'accrual') {
      setSaleType('all');
      setPayment('paid');
      return;
    }
    setSaleType(key);
    setPayment('paid');
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-400">
          {payment === 'unpaid'
            ? 'Неоплаченные продажи'
            : 'Личные продажи за период'}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`rounded-xl px-3 py-1.5 text-sm ${
              payment === 'unpaid'
                ? 'bg-amber-500/20 text-amber-200'
                : 'border border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
            onClick={() => {
              setPayment('unpaid');
              setActiveSegment('unpaid');
              setListOpen(true);
            }}
          >
            Мои долги
          </button>
          <button
            type="button"
            className={`rounded-xl px-3 py-1.5 text-sm ${
              payment !== 'unpaid'
                ? 'bg-fitgo-500/20 text-fitgo-300'
                : 'border border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
            onClick={() => {
              setPayment('all');
              setSaleType('all');
              setActiveSegment(null);
              setListOpen(false);
            }}
          >
            Все продажи
          </button>
        </div>
      </div>
      <div className="card flex flex-wrap items-end gap-3 !p-3">
        <DateField label="С" value={from} onChange={setFrom} />
        <DateField label="По" value={to} onChange={setTo} />
        <label className="min-w-[8rem] flex-1 text-sm sm:flex-none">
          <span className="mb-1 block text-slate-400">Вид</span>
          <select
            className="input"
            value={saleType}
            onChange={(e) => {
              const next = e.target.value as AdminSaleType | 'all';
              setSaleType(next);
              setActiveSegment(
                next === 'all' ? null : (next as SalesSegmentKey),
              );
              setListOpen(next !== 'all' || payment !== 'all');
            }}
          >
            <option value="all">Все</option>
            <option value="membership">Абонементы</option>
            <option value="massage">Массаж</option>
            <option value="solarium">Солярий</option>
            <option value="shop">Магазин</option>
          </select>
        </label>
        <label className="min-w-[8rem] flex-1 text-sm sm:flex-none">
          <span className="mb-1 block text-slate-400">Оплата</span>
          <select
            className="input"
            value={payment}
            onChange={(e) => {
              const next = e.target.value as AdminSalePaymentFilter;
              setPayment(next);
              if (next === 'unpaid') setActiveSegment('unpaid');
              else if (next === 'all' && saleType === 'all') {
                setActiveSegment(null);
                setListOpen(false);
              } else {
                setListOpen(true);
              }
            }}
          >
            <option value="all">Все</option>
            <option value="paid">Оплачена</option>
            <option value="unpaid">Не оплачена</option>
          </select>
        </label>
      </div>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {loading && !data ? (
        <p className="text-sm text-slate-500">Загрузка…</p>
      ) : data ? (
        <>
          <TotalsBar
            totals={data.totals}
            attributionLabel={data.attributionLabel}
            activeSegment={activeSegment}
            onSegmentClick={onSegmentClick}
          />
          {listOpen ? (
            loading ? (
              <p className="text-sm text-slate-500">Загрузка списка…</p>
            ) : (
              <LinesTable lines={data.lines} />
            )
          ) : (
            <p className="text-sm text-slate-500">
              Нажмите сумму, чтобы открыть продажи
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

export function SuperAdminSalesPanel() {
  const bounds = useMemo(() => monthBounds(), []);
  const [from, setFrom] = useState(bounds.from);
  const [to, setTo] = useState(bounds.to);
  const [saleType, setSaleType] = useState<AdminSaleType | 'all'>('all');
  const [payment, setPayment] = useState<AdminSalePaymentFilter>('all');
  const [q, setQ] = useState('');
  const [data, setData] = useState<AdminSalesOverviewResponse | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminSalesStaffDetailResponse | null>(
    null,
  );
  const [error, setError] = useState('');
  const [syncMsg, setSyncMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.superAdminSales(token, {
        from,
        to,
        saleType,
        payment,
        q: q.trim() || undefined,
      });
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [from, to, saleType, payment, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleExpand = async (userId: string) => {
    if (expanded === userId) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    const token = getToken();
    if (!token) return;
    setExpanded(userId);
    try {
      const d = await api.superAdminSalesStaff(token, userId, {
        from,
        to,
        saleType,
        payment,
      });
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
      await api.superAdminSalesSync(token);
      const deadline = Date.now() + 12 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const s = await api.superAdminSalesSyncStatus(token);
        if (s.running) {
          setSyncMsg('Синхронизация… (идёт обмен с 1С)');
          continue;
        }
        if (s.error) throw new Error(s.error);
        setSyncMsg(
          s.lastSyncedAt
            ? `Готово (${new Date(s.lastSyncedAt).toLocaleString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })})`
            : 'Синхронизация завершена',
        );
        await load();
        return;
      }
      throw new Error('Синхронизация слишком долгая — обновите страницу через пару минут');
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : 'Ошибка sync');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Продажи</h2>
        <button type="button" className="btn-secondary text-sm" onClick={syncNow}>
          Обновить из 1С
        </button>
      </div>
      {syncMsg ? <p className="text-sm text-slate-400">{syncMsg}</p> : null}
      <div className="card flex flex-wrap gap-3">
        <DateField label="С" value={from} onChange={setFrom} />
        <DateField label="По" value={to} onChange={setTo} />
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">Вид</span>
          <select
            className="input"
            value={saleType}
            onChange={(e) =>
              setSaleType(e.target.value as AdminSaleType | 'all')
            }
          >
            <option value="all">Все</option>
            <option value="membership">Абонементы</option>
            <option value="massage">Массаж</option>
            <option value="solarium">Солярий</option>
            <option value="shop">Магазин</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">Оплата</span>
          <select
            className="input"
            value={payment}
            onChange={(e) =>
              setPayment(e.target.value as AdminSalePaymentFilter)
            }
          >
            <option value="all">Все</option>
            <option value="paid">Оплачена</option>
            <option value="unpaid">Не оплачена</option>
          </select>
        </label>
        <label className="text-sm grow">
          <span className="mb-1 block text-slate-400">ФИО</span>
          <input
            className="input w-full"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск"
          />
        </label>
      </div>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {loading && !data ? (
        <p className="text-sm text-slate-500">Загрузка…</p>
      ) : null}
      {data ? (
        <AdminStickyTable>
            <thead className="bg-slate-900/80 text-xs font-medium text-slate-400">
              <tr>
                <th className="px-3 py-2">Админ</th>
                <th className="px-3 py-2 text-right">Абонементы</th>
                <th className="px-3 py-2 text-right">Массаж</th>
                <th className="px-3 py-2 text-right">Солярий</th>
                <th className="px-3 py-2 text-right">Магазин</th>
                <th className="px-3 py-2 text-right">Неоплачено</th>
                <th className="px-3 py-2 text-right">К начислению</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <Fragment key={row.userId}>
                  <tr
                    className="cursor-pointer border-t border-slate-800 hover:bg-slate-900/60"
                    onClick={() => void toggleExpand(row.userId)}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.name}</div>
                      <div className="text-xs text-slate-500">
                        {row.attributionLabel}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {money(row.membershipPaidMinor)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {money(row.massagePaidMinor)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {money(row.solariumPaidMinor)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {money(row.shopPaidMinor)}
                    </td>
                    <td className="px-3 py-2 text-right text-amber-300">
                      {money(row.unpaidMinor)}
                    </td>
                    <td className="px-3 py-2 text-right text-fitgo-300">
                      {money(row.accrualTotalMinor)}
                    </td>
                  </tr>
                  {expanded === row.userId && detail?.userId === row.userId ? (
                    <tr className="bg-slate-950/50">
                      <td colSpan={7} className="px-3 py-3">
                        <TotalsBar
                          totals={detail.totals}
                          attributionLabel={detail.attributionLabel}
                        />
                        <div className="mt-3">
                          <LinesTable lines={detail.lines} />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
        </AdminStickyTable>
      ) : null}
    </div>
  );
}
