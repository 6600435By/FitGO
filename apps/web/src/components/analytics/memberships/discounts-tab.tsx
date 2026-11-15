'use client';

import type {
  MembershipDiscountsReport,
  MembershipEfficiencyBasis,
} from '@fitgo/shared-types';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { errMessage, money, moneyOrDash, num, pct } from './format';

export function DiscountsTab({
  from,
  to,
  basis,
  family,
  onError,
}: {
  from: string;
  to: string;
  basis: MembershipEfficiencyBasis;
  family?: string;
  onError: (msg: string) => void;
}) {
  const [data, setData] = useState<MembershipDiscountsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    api
      .analyticsMembershipsDiscounts(token, { from, to, basis, family })
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) onErrorRef.current(errMessage(e, 'Ошибка загрузки скидок'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, basis, family]);

  if (loading && !data) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="card text-sm text-slate-400">
        Нет данных по скидкам за период.
      </div>
    );
  }

  const currency = data.currency;
  const wd = data.withoutDiscount;

  return (
    <div className={`space-y-3 ${loading ? 'opacity-60' : ''}`}>
      {wd && (
        <div className="card">
          <h3 className="mb-2 font-semibold">Без скидки (для сравнения)</h3>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Stat label="Продаж" value={String(wd.salesCount)} />
            <Stat label="Ср. оплата" value={money(wd.avgPaidMinor, currency)} />
            <Stat label="Маржа %" value={pct(wd.marginPct)} />
            <Stat label="ГП / мес" value={num(wd.avgGpPerMonth)} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Сравните маржу и частоту ГП со скидочными продажами ниже: глубокая
            скидка + частые визиты ГП = главный источник убытка.
          </p>
        </div>
      )}

      <div className="card overflow-x-auto">
        <h3 className="mb-2 font-semibold">Скидки и акции</h3>
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-1 pr-2">Скидка</th>
              <th className="py-1 pr-2">Продаж</th>
              <th className="py-1 pr-2">Сумма скидок</th>
              <th className="py-1 pr-2">Ср. %</th>
              <th className="py-1 pr-2">Ср. оплата</th>
              <th className="py-1 pr-2">Ср. прайс</th>
              <th className="py-1 pr-2">ГП / мес</th>
              <th className="py-1 pr-2">Маржа</th>
              <th className="py-1">Маржа %</th>
            </tr>
          </thead>
          <tbody>
            {data.discounts.map((d) => (
              <tr key={d.discountName} className="border-t border-slate-800">
                <td className="py-1.5 pr-2">{d.discountName}</td>
                <td className="py-1.5 pr-2">{d.salesCount}</td>
                <td className="py-1.5 pr-2">
                  {money(d.discountAmountMinor, currency)}
                </td>
                <td className="py-1.5 pr-2">{pct(d.avgDiscountPct)}</td>
                <td className="py-1.5 pr-2">{money(d.avgPaidMinor, currency)}</td>
                <td className="py-1.5 pr-2">
                  {moneyOrDash(d.avgRetailMinor, currency)}
                </td>
                <td className="py-1.5 pr-2">{num(d.avgGpPerMonth)}</td>
                <td
                  className={`py-1.5 pr-2 ${
                    d.marginMinor < 0 ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {money(d.marginMinor, currency)}
                </td>
                <td
                  className={`py-1.5 ${
                    d.marginPct != null && d.marginPct < 0 ? 'text-rose-400' : ''
                  }`}
                >
                  {pct(d.marginPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.discounts.length && (
          <p className="py-4 text-center text-sm text-slate-500">
            Продаж со скидкой за период нет
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="stat-value text-lg">{value}</p>
      <p className="stat-label">{label}</p>
    </div>
  );
}
