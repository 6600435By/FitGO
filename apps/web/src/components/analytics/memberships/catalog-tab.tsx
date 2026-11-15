'use client';

import type { MembershipProductCatalogRow } from '@fitgo/shared-types';
import { Fragment, useMemo, useState } from 'react';
import { Badge } from './fields';
import { STATUS_DOT, money, moneyOrDash, pct } from './format';

const NO_GROUP = 'Без группы';

/** Horizontal scale: retail | avg paid | breakeven. */
export function PriceScaleBar({
  retailMinor,
  paidMinor,
  breakevenMinor,
  currency,
}: {
  retailMinor: number | null;
  paidMinor: number;
  breakevenMinor: number | null;
  currency: string;
}) {
  const values = [retailMinor, paidMinor, breakevenMinor].filter(
    (v): v is number => v != null && v > 0,
  );
  const scale = Math.max(1, ...values) * 1.05;
  const left = (v: number) => `${Math.min(100, Math.max(0, (v / scale) * 100))}%`;
  const paidAboveBe = breakevenMinor != null ? paidMinor >= breakevenMinor : null;
  return (
    <div
      className="min-w-[160px]"
      title={`Прайс ${moneyOrDash(retailMinor, currency)} · оплата ${money(paidMinor, currency)} · BE ${moneyOrDash(breakevenMinor, currency)}`}
    >
      <div className="relative h-2 rounded bg-slate-800">
        {breakevenMinor != null && breakevenMinor > 0 && (
          <div
            className="absolute inset-y-0 left-0 rounded-l bg-rose-500/30"
            style={{ width: left(breakevenMinor) }}
          />
        )}
        {retailMinor != null && retailMinor > 0 && (
          <span
            className="absolute -top-0.5 h-3 w-0.5 bg-slate-300"
            style={{ left: left(retailMinor) }}
          />
        )}
        {breakevenMinor != null && breakevenMinor > 0 && (
          <span
            className="absolute -top-0.5 h-3 w-0.5 bg-rose-400"
            style={{ left: left(breakevenMinor) }}
          />
        )}
        <span
          className={`absolute -top-1 h-4 w-1.5 -translate-x-1/2 rounded ${
            paidAboveBe === false ? 'bg-amber-400' : 'bg-fitgo-500'
          }`}
          style={{ left: left(paidMinor) }}
        />
      </div>
      <div className="mt-1 flex gap-2 text-[10px] text-slate-500">
        <span>
          <i className="mr-0.5 inline-block h-2 w-0.5 bg-slate-300 align-middle" />
          прайс
        </span>
        <span>
          <i className="mr-0.5 inline-block h-2 w-1 rounded bg-fitgo-500 align-middle" />
          оплата
        </span>
        <span>
          <i className="mr-0.5 inline-block h-2 w-0.5 bg-rose-400 align-middle" />
          BE
        </span>
      </div>
    </div>
  );
}

export function CatalogTab({
  products,
  currency,
  onOpenProduct,
}: {
  products: MembershipProductCatalogRow[];
  currency: string;
  onOpenProduct: (productExternalId: string) => void;
}) {
  const [group, setGroup] = useState<string>('ALL');
  const [onlyWithDiscount, setOnlyWithDiscount] = useState(false);
  const [lossMaking, setLossMaking] = useState(false);
  const [incomplete, setIncomplete] = useState(false);

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) set.add(p.groupLabel?.trim() || NO_GROUP);
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [products]);

  const grouped = useMemo(() => {
    const filtered = products.filter((p) => {
      const g = p.groupLabel?.trim() || NO_GROUP;
      if (group !== 'ALL' && g !== group) return false;
      if (
        onlyWithDiscount &&
        !((p.avgDiscountPct ?? 0) > 0 || (p.soldWithDiscountShare ?? 0) > 0)
      ) {
        return false;
      }
      if (lossMaking && !(p.marginMinor < 0 || p.status === 'red')) return false;
      if (incomplete && p.compositionComplete) return false;
      return true;
    });
    const map = new Map<string, MembershipProductCatalogRow[]>();
    for (const p of filtered) {
      const g = p.groupLabel?.trim() || NO_GROUP;
      const arr = map.get(g) ?? [];
      arr.push(p);
      map.set(g, arr);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'ru'))
      .map(
        ([g, rows]) =>
          [g, [...rows].sort((a, b) => b.soldCount - a.soldCount)] as const,
      );
  }, [products, group, onlyWithDiscount, lossMaking, incomplete]);

  const total = grouped.reduce((s, [, rows]) => s + rows.length, 0);

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">Группа</span>
          <select
            className="input"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            <option value="ALL">Все группы</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <FilterChip
          active={onlyWithDiscount}
          onClick={() => setOnlyWithDiscount((v) => !v)}
          label="Со скидкой"
        />
        <FilterChip
          active={lossMaking}
          onClick={() => setLossMaking((v) => !v)}
          label="Убыточные"
        />
        <FilterChip
          active={incomplete}
          onClick={() => setIncomplete((v) => !v)}
          label="Состав не заполнен"
        />
        <span className="ml-auto text-xs text-slate-500">
          Карточек: {total} из {products.length}
        </span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-1 pr-2">Абонемент</th>
              <th className="py-1 pr-2">N</th>
              <th className="py-1 pr-2">Прайс</th>
              <th className="py-1 pr-2">Ср. оплата</th>
              <th className="py-1 pr-2">Скидка %</th>
              <th className="py-1 pr-2">BE цена</th>
              <th className="py-1 pr-2">Шкала цены</th>
              <th className="py-1 pr-2">ГП/мес</th>
              <th className="py-1 pr-2">Макс ГП/мес</th>
              <th className="py-1 pr-2">Маржа</th>
              <th className="py-1">Маржа %</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(([g, rows]) => (
              <Fragment key={g}>
                <tr className="bg-slate-900/60">
                  <td
                    colSpan={11}
                    className="py-1.5 pl-1 text-xs font-medium uppercase tracking-wide text-slate-400"
                  >
                    {g} · {rows.length}
                  </td>
                </tr>
                {rows.map((p) => (
                  <tr
                    key={p.productExternalId}
                    className="cursor-pointer border-t border-slate-800 hover:bg-slate-800/40"
                    onClick={() => onOpenProduct(p.productExternalId)}
                  >
                    <td className="py-1.5 pr-2">
                      <span
                        className={`mr-1.5 inline-block h-2 w-2 rounded-full ${STATUS_DOT[p.status]}`}
                      />
                      {p.name}
                      {!p.compositionComplete && (
                        <span className="ml-1.5">
                          <Badge tone="amber" title="Состав абонемента не заполнен полностью">
                            состав?
                          </Badge>
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">{p.soldCount}</td>
                    <td className="py-1.5 pr-2">
                      {moneyOrDash(p.retailPriceMinor, currency)}
                    </td>
                    <td className="py-1.5 pr-2">{money(p.avgPaidMinor, currency)}</td>
                    <td className="py-1.5 pr-2">{pct(p.avgDiscountPct)}</td>
                    <td className="py-1.5 pr-2">
                      {moneyOrDash(p.breakevenPriceMinor, currency)}
                    </td>
                    <td className="py-1.5 pr-2">
                      <PriceScaleBar
                        retailMinor={p.retailPriceMinor}
                        paidMinor={p.avgPaidMinor}
                        breakevenMinor={p.breakevenPriceMinor}
                        currency={currency}
                      />
                    </td>
                    <td className="py-1.5 pr-2">{p.avgGpPerMonth}</td>
                    <td className="py-1.5 pr-2">{p.maxGpVisitsPerMonth ?? '—'}</td>
                    <td
                      className={`py-1.5 pr-2 ${
                        p.marginMinor < 0 ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {money(p.marginMinor, currency)}
                    </td>
                    <td className="py-1.5">{pct(p.marginPct)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
        {total === 0 && (
          <p className="py-4 text-center text-sm text-slate-500">
            Нет абонементов по выбранным фильтрам
          </p>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs ${
        active ? 'bg-fitgo-500 text-white' : 'bg-slate-800'
      }`}
    >
      {label}
    </button>
  );
}
