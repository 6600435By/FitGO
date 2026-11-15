'use client';

import type {
  MembershipServicePromiseRow,
  MembershipVisitBucket,
  MembershipWaterfallStep,
} from '@fitgo/shared-types';
import { money } from './format';

/** Waterfall bars (no card wrapper — caller provides container). */
export function WaterfallBlock({
  steps,
  currency,
}: {
  steps: MembershipWaterfallStep[];
  currency: string;
}) {
  const maxAbs = Math.max(1, ...steps.map((s) => Math.abs(s.runningMinor)));
  return (
    <div className="space-y-2">
      {steps.map((s) => (
        <div key={s.key} className="text-sm">
          <div className="mb-0.5 flex justify-between gap-2 text-xs">
            <span className="text-slate-400">{s.label}</span>
            <span>
              {s.key !== 'margin' && s.deltaMinor !== 0
                ? `${s.deltaMinor > 0 ? '+' : ''}${money(s.deltaMinor, currency)} → `
                : ''}
              {money(s.runningMinor, currency)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-slate-800">
            <div
              className={`h-full ${
                s.key === 'margin'
                  ? s.runningMinor >= 0
                    ? 'bg-emerald-500'
                    : 'bg-rose-500'
                  : s.deltaMinor >= 0
                    ? 'bg-fitgo-500'
                    : 'bg-slate-500'
              }`}
              style={{
                width: `${Math.min(100, (Math.abs(s.runningMinor) / maxAbs) * 100)}%`,
              }}
            />
          </div>
        </div>
      ))}
      {!steps.length && <p className="text-xs text-slate-500">Нет данных</p>}
    </div>
  );
}

export function ServicePromiseBlock({
  rows,
  currency,
}: {
  rows: MembershipServicePromiseRow[];
  currency: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="py-1 pr-2">Услуга</th>
            <th className="py-1 pr-2">Обещано</th>
            <th className="py-1 pr-2">Исп.</th>
            <th className="py-1">Сгорело</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-slate-800">
              <td className="py-1.5 pr-2">{r.label}</td>
              <td className="py-1.5 pr-2">{money(r.promisedMinor, currency)}</td>
              <td className="py-1.5 pr-2">{money(r.usedMinor, currency)}</td>
              <td className="py-1.5">{money(r.burnedMinor, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function VisitDistributionBars({
  buckets,
  onBucketClick,
  heightClass = 'h-36',
}: {
  buckets: MembershipVisitBucket[];
  onBucketClick?: (b: MembershipVisitBucket) => void;
  heightClass?: string;
}) {
  const maxBucket = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className={`flex items-end gap-2 ${heightClass}`}>
      {buckets.map((b) => (
        <button
          key={b.key}
          type="button"
          title={`${b.label}: ${b.count}`}
          disabled={!onBucketClick}
          className="flex h-full flex-1 flex-col items-center justify-end gap-1"
          onClick={() => onBucketClick?.(b)}
        >
          <span className="text-[10px] text-slate-400">{b.count}</span>
          <div
            className="min-h-[4px] w-full rounded-t bg-fitgo-500/80"
            style={{
              height: `${Math.max(4, (b.count / maxBucket) * 80)}%`,
            }}
          />
          <span className="text-[10px] text-slate-500">{b.label}</span>
        </button>
      ))}
    </div>
  );
}
