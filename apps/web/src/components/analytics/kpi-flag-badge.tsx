'use client';

import type { KpiFlag } from '@fitgo/shared-types';

const STYLE: Record<KpiFlag['severity'], string> = {
  problem: 'bg-rose-500/20 text-rose-300',
  achievement: 'bg-emerald-500/20 text-emerald-300',
  info: 'bg-slate-700 text-slate-300',
};

export function KpiFlagBadge({ flag }: { flag: KpiFlag }) {
  return (
    <span
      title={flag.reason}
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] ${STYLE[flag.severity]}`}
    >
      {flag.label}
    </span>
  );
}
