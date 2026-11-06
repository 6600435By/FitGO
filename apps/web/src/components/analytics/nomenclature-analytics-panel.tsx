'use client';

import type { NomenclatureAnalyticsReport } from '@fitgo/shared-types';
import Link from 'next/link';
import { AnalyticsDataQualityBar } from './analytics-filters-bar';

function money(minor: number, currency: string) {
  return `${(minor / 100).toLocaleString('ru-RU', {
    maximumFractionDigits: 0,
  })}\u00a0${currency}`;
}

function salesHref(
  from: string,
  to: string,
  extra: Record<string, string | undefined>,
) {
  const q = new URLSearchParams({ from, to });
  for (const [k, v] of Object.entries(extra)) {
    if (v) q.set(k, v);
  }
  return `/super-admin/sales?${q.toString()}`;
}

export function NomenclatureAnalyticsPanel({
  report,
  onPickSegment,
  onPickProduct,
  onPickEmployee,
}: {
  report: NomenclatureAnalyticsReport;
  onPickSegment?: (segment: string) => void;
  onPickProduct?: (productId: string, name: string) => void;
  onPickEmployee?: (employeeId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <AnalyticsDataQualityBar
        coverage={report.coverage}
        filtersActive={report.appliedFilters?.active}
      />
      <p className="text-sm text-slate-400">
        Выручка в срезе:{' '}
        <span className="text-slate-200">
          {money(report.revenueMinor, report.currency)}
        </span>
        . Магазин — топ по выручке, остальные позиции свёрнуты.
      </p>
      {report.segments.map((seg) => (
        <section key={seg.key} className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="font-semibold text-fitgo-400 hover:underline"
              onClick={() => onPickSegment?.(seg.key)}
            >
              {seg.label}
            </button>
            <span className="text-sm text-slate-300">
              {money(seg.amountMinor, report.currency)} ·{' '}
              {Math.round(seg.share * 100)}%
            </span>
          </div>
          {seg.key === 'shop' && seg.shopTopShareOfSegment != null && (
            <p className="text-xs text-slate-500">
              Топ закрывает {Math.round(seg.shopTopShareOfSegment * 100)}%
              выручки магазина
              {seg.shopRemainder
                ? ` · ещё ${seg.shopRemainder.productCount} позиций на ${money(seg.shopRemainder.amountMinor, report.currency)}`
                : ''}
            </p>
          )}
          {seg.products.length === 0 ? (
            <p className="text-sm text-slate-500">Нет продаж за период</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="py-1 pr-2">Услуга</th>
                    <th className="px-2 py-1 text-right">Док.</th>
                    <th className="px-2 py-1 text-right">Выручка</th>
                    <th className="px-2 py-1 text-right">Доля</th>
                    <th className="px-2 py-1 text-right">Ср. чек</th>
                    <th className="px-2 py-1 text-right">Δ</th>
                    <th className="px-2 py-1">Топ продавцы</th>
                  </tr>
                </thead>
                <tbody>
                  {seg.products.map((p) => (
                    <tr
                      key={`${p.productExternalId ?? p.productName}`}
                      className="border-t border-slate-700/50"
                    >
                      <td className="py-1.5 pr-2">
                        <button
                          type="button"
                          className="text-left text-fitgo-400 hover:underline"
                          onClick={() =>
                            onPickProduct?.(
                              p.productExternalId ?? p.productName,
                              p.productName,
                            )
                          }
                        >
                          {p.productName}
                        </button>
                        <div>
                          <Link
                            href={salesHref(report.from, report.to, {
                              productId: p.productExternalId ?? undefined,
                              q: p.productExternalId
                                ? undefined
                                : p.productName,
                              segment:
                                seg.key === 'spa'
                                  ? 'massage'
                                  : seg.key === 'unclassified'
                                    ? undefined
                                    : seg.key,
                            })}
                            className="text-xs text-slate-500 hover:underline"
                          >
                            Продажи →
                          </Link>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right">{p.docs}</td>
                      <td className="px-2 py-1.5 text-right">
                        {money(p.amountMinor, report.currency)}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {Math.round(p.shareOfSegment * 100)}%
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {money(p.avgCheckMinor, report.currency)}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {p.deltaPct == null
                          ? 'н/д'
                          : `${p.deltaPct > 0 ? '+' : ''}${p.deltaPct}%`}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-slate-400">
                        {p.topSellers.map((s) => (
                          <button
                            key={`${s.employeeExternalId}-${s.employeeName}`}
                            type="button"
                            className="mr-2 hover:text-fitgo-400"
                            onClick={() => {
                              if (s.employeeExternalId)
                                onPickEmployee?.(s.employeeExternalId);
                            }}
                          >
                            {s.employeeName}{' '}
                            {money(s.amountMinor, report.currency)}
                          </button>
                        ))}
                      </td>
                    </tr>
                  ))}
                  {seg.shopRemainder && (
                    <tr className="border-t border-slate-700/50 text-slate-500">
                      <td className="py-1.5 pr-2">
                        Остальные {seg.shopRemainder.productCount} позиций
                      </td>
                      <td />
                      <td className="px-2 py-1.5 text-right">
                        {money(
                          seg.shopRemainder.amountMinor,
                          report.currency,
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {Math.round(seg.shopRemainder.shareOfSegment * 100)}%
                      </td>
                      <td colSpan={3} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
