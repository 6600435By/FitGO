'use client';

import { useState } from 'react';
import type {
  AttentionChip,
  AttentionKind,
  ReportTabId,
} from '@/components/payroll/employee-report/work-unit-status';
import { tabForAttention } from '@/components/payroll/employee-report/work-unit-status';

type Props = {
  chips: AttentionChip[];
  anomalyHints: string[];
  onOpen: (tab: ReportTabId, kind: AttentionKind) => void;
};

export function AttentionBar({ chips, anomalyHints, onOpen }: Props) {
  const [hintsOpen, setHintsOpen] = useState(false);
  if (chips.length === 0) return null;

  return (
    <section className="space-y-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-amber-200/80">
        Требует внимания
      </p>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <button
            key={chip.kind}
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-slate-950/40 px-2.5 py-1 text-xs text-amber-100 hover:border-amber-400/50 hover:bg-amber-500/10"
            onClick={() => {
              if (chip.kind === 'anomaly') {
                setHintsOpen((o) => !o);
                return;
              }
              onOpen(tabForAttention(chip.kind), chip.kind);
            }}
          >
            <span className="font-medium">{chip.label}</span>
            <span className="tabular-nums text-amber-300/90">{chip.count}</span>
          </button>
        ))}
      </div>
      {(hintsOpen || chips.some((c) => c.kind === 'anomaly' && anomalyHints.length <= 2)) &&
      anomalyHints.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-amber-200/90">
          {anomalyHints.map((h) => (
            <li key={h}>· {h}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
