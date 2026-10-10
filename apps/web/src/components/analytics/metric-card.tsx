'use client';

import type { AnalyticMetric } from '@fitgo/shared-types';
import { Sparkline } from './sparkline';

function formatValue(m: AnalyticMetric, currency: string) {
  if (m.unit === 'money') {
    return `${(m.value / 100).toLocaleString('ru-RU', {
      maximumFractionDigits: 0,
    })}\u00a0${currency}`;
  }
  if (m.unit === 'percent') return `${m.value}%`;
  if (m.unit === 'hours') return `${m.value}`;
  return m.value.toLocaleString('ru-RU');
}

export function MetricCard({
  label,
  metric,
  currency = 'BYN',
}: {
  label: string;
  metric: AnalyticMetric;
  currency?: string;
}) {
  const delta = metric.deltaPct;
  const deltaColor =
    delta == null
      ? 'text-slate-500'
      : delta > 0
        ? 'text-emerald-400'
        : delta < 0
          ? 'text-rose-400'
          : 'text-slate-400';
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="stat-value text-xl">{formatValue(metric, currency)}</p>
          <p className="stat-label">{label}</p>
        </div>
        <Sparkline values={metric.trend} />
      </div>
      {delta != null && (
        <p className={`mt-1 text-xs ${deltaColor}`}>
          {delta > 0 ? '+' : ''}
          {delta}% к сравнению
        </p>
      )}
      {metric.hint && (
        <p className="mt-1 text-[11px] text-slate-500">{metric.hint}</p>
      )}
    </div>
  );
}
