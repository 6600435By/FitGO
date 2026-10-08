'use client';

import type {
  MotivationCategoryBreakdown,
  StaffSalesBreakdown,
} from '@fitgo/shared-types';

function money(minor: number, currency: string) {
  return `${(minor / 100).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

const ROWS: {
  key: keyof MotivationCategoryBreakdown;
  salesKey: keyof Pick<
    StaffSalesBreakdown,
    'membershipMinor' | 'massageMinor' | 'solariumMinor' | 'shopMinor' | 'corporateMinor'
  >;
  label: string;
}[] = [
  { key: 'membershipMinor', salesKey: 'membershipMinor', label: 'Абонементы' },
  { key: 'spaMinor', salesKey: 'massageMinor', label: 'Спа' },
  { key: 'solariumMinor', salesKey: 'solariumMinor', label: 'Солярий' },
  { key: 'shopMinor', salesKey: 'shopMinor', label: 'Магазин' },
  { key: 'corporateMinor', salesKey: 'corporateMinor', label: 'Корпо' },
];

type Props = {
  breakdown: MotivationCategoryBreakdown;
  sales?: StaffSalesBreakdown;
  currency: string;
  className?: string;
};

/** Compact non-zero lines: category → contribution (+ muted sales base). */
export function MotivationBreakdownList({
  breakdown,
  sales,
  currency,
  className,
}: Props) {
  const lines = ROWS.filter((r) => breakdown[r.key] > 0).map((r) => {
    const base =
      r.salesKey === 'massageMinor' || r.salesKey === 'solariumMinor'
        ? (sales?.[r.salesKey] ?? 0)
        : (sales?.[r.salesKey] ?? 0);
    return { ...r, contrib: breakdown[r.key], base };
  });
  if (lines.length === 0) return null;

  return (
    <ul className={className ?? 'space-y-1 text-sm'}>
      {lines.map((line) => (
        <li
          key={line.key}
          className="flex items-baseline justify-between gap-3 text-slate-300"
        >
          <span className="min-w-0">
            <span className="text-slate-400">{line.label}</span>
            {line.base > 0 ? (
              <span className="ml-1.5 text-[11px] text-slate-500">
                база {money(line.base, currency)}
              </span>
            ) : null}
          </span>
          <span className="shrink-0 tabular-nums text-slate-200">
            {money(line.contrib, currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}
