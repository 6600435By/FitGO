'use client';

import { useCallback, useEffect, useMemo, useState, Fragment } from 'react';
import type {
  AdminMySalesResponse,
  AdminSaleLineDto,
  AdminSalePaymentFilter,
  AdminSaleType,
  AdminSalesOverviewResponse,
  AdminSalesStaffDetailResponse,
} from '@fitgo/shared-types';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

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

function TotalsBar({
  totals,
  attributionLabel,
}: {
  totals: AdminMySalesResponse['totals'];
  attributionLabel: string;
}) {
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-slate-400">Режим абонементов</span>
        <span className="rounded-full bg-slate-800 px-3 py-1 text-fitgo-300">
          {attributionLabel}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-sm">
        <div>
          <div className="text-slate-500">Абонементы (оплачено)</div>
          <div className="font-semibold">{money(totals.membershipPaidMinor)}</div>
        </div>
        <div>
          <div className="text-slate-500">Массаж (оплачено)</div>
          <div className="font-semibold">{money(totals.massagePaidMinor)}</div>
        </div>
        <div>
          <div className="text-slate-500">Солярий (оплачено)</div>
          <div className="font-semibold">{money(totals.solariumPaidMinor)}</div>
        </div>
        <div>
          <div className="text-slate-500">Магазин (оплачено)</div>
          <div className="font-semibold">{money(totals.shopPaidMinor)}</div>
        </div>
        <div>
          <div className="text-slate-500">Неоплачено (долг)</div>
          <div className="font-semibold text-amber-300">
            {money(totals.unpaidMinor)}
          </div>
        </div>
        <div>
          <div className="text-slate-500">К начислению</div>
          <div className="font-semibold text-fitgo-300">
            {money(totals.accrualTotalMinor)}
          </div>
        </div>
      </div>
      <div className="grid gap-1 border-t border-slate-800 pt-2 text-xs text-slate-400 sm:grid-cols-3">
        <span>Абонементы × %: {money(totals.accrualMembershipMinor)}</span>
        <span>Массаж/солярий × %: {money(totals.accrualExtraMinor)}</span>
        <span>Магазин × %: {money(totals.accrualShopMinor)}</span>
      </div>
    </div>
  );
}

function LinesTable({ lines }: { lines: AdminSaleLineDto[] }) {
  if (!lines.length) {
    return (
      <p className="text-sm text-slate-500">Нет продаж за выбранный период</p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-900/80 text-slate-400">
          <tr>
            <th className="px-3 py-2 font-medium">Клиент</th>
            <th className="px-3 py-2 font-medium">Вид</th>
            <th className="px-3 py-2 font-medium">Продажа</th>
            <th className="px-3 py-2 font-medium">Оплата</th>
            <th className="px-3 py-2 font-medium text-right">Сумма</th>
            <th className="px-3 py-2 font-medium">Статус</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-t border-slate-800">
              <td className="px-3 py-2">
                <div>{line.clientName ?? '—'}</div>
                {line.productName ? (
                  <div className="text-xs text-slate-500">{line.productName}</div>
                ) : null}
                {line.employeeName ? (
                  <div className="text-xs text-slate-600">
                    автор 1С: {line.employeeName}
                  </div>
                ) : null}
              </td>
              <td className="px-3 py-2">{saleTypeLabel(line.saleType)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {line.soldAt.slice(0, 10)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {line.paidAt ? line.paidAt.slice(0, 10) : '—'}
              </td>
              <td className="px-3 py-2 text-right font-medium">
                {money(line.attributedMinor)}
              </td>
              <td className="px-3 py-2">
                {line.paid ? (
                  <span className="text-fitgo-300">Оплачена</span>
                ) : (
                  <span className="text-amber-300">Не оплачена</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminMySalesPanel() {
  const bounds = useMemo(() => monthBounds(), []);
  const [from, setFrom] = useState(bounds.from);
  const [to, setTo] = useState(bounds.to);
  const [saleType, setSaleType] = useState<AdminSaleType | 'all'>('all');
  const [payment, setPayment] = useState<AdminSalePaymentFilter>('all');
  const [data, setData] = useState<AdminMySalesResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
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
      });
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [from, to, saleType, payment]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Мои продажи</h2>
      <div className="card flex flex-wrap gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">С</span>
          <input
            type="date"
            className="input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">По</span>
          <input
            type="date"
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
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
      </div>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {data?.hint ? (
        <p className="text-sm text-amber-300">{data.hint}</p>
      ) : null}
      {loading && !data ? (
        <p className="text-sm text-slate-500">Загрузка…</p>
      ) : data ? (
        <>
          <TotalsBar
            totals={data.totals}
            attributionLabel={data.attributionLabel}
          />
          <LinesTable lines={data.lines} />
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
      const r = await api.superAdminSalesSync(token);
      setSyncMsg(
        `Готово: ${r.upserted} строк, снято ${r.deactivated} (${r.from}–${r.to})`,
      );
      await load();
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
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">С</span>
          <input
            type="date"
            className="input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">По</span>
          <input
            type="date"
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
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
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-900/80 text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">Админ</th>
                <th className="px-3 py-2 font-medium text-right">Абонементы</th>
                <th className="px-3 py-2 font-medium text-right">Массаж</th>
                <th className="px-3 py-2 font-medium text-right">Солярий</th>
                <th className="px-3 py-2 font-medium text-right">Магазин</th>
                <th className="px-3 py-2 font-medium text-right">Неоплачено</th>
                <th className="px-3 py-2 font-medium text-right">К начислению</th>
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
          </table>
        </div>
      ) : null}
    </div>
  );
}
