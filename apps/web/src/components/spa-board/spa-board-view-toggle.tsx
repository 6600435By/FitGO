'use client';

import type { SpaBoardView } from './spa-board-period';

const LABELS: Record<SpaBoardView, string> = {
  day: 'День',
  week: 'Неделя',
};

export function SpaBoardViewToggle({
  view,
  onChange,
}: {
  view: SpaBoardView;
  onChange: (v: SpaBoardView) => void;
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-full border border-slate-700/80 bg-slate-950/80 p-0.5 shadow-sm">
      {(['day', 'week'] as const).map((key) => (
        <button
          key={key}
          type="button"
          className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
            view === key
              ? 'bg-fitgo-500 text-white shadow-sm'
              : 'text-slate-500 hover:bg-slate-800/60 hover:text-slate-200'
          }`}
          onClick={() => onChange(key)}
        >
          {LABELS[key]}
        </button>
      ))}
    </div>
  );
}
