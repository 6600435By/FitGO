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
    <div className="flex gap-1 rounded-full bg-slate-800/80 p-0.5">
      {(['day', 'week'] as const).map((key) => (
        <button
          key={key}
          type="button"
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            view === key
              ? 'bg-fitgo-500 text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
          onClick={() => onChange(key)}
        >
          {LABELS[key]}
        </button>
      ))}
    </div>
  );
}
