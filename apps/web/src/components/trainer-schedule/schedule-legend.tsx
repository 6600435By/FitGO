'use client';

import { EVENT_KIND_LEGEND } from './event-kind-styles';

export function ScheduleLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-400">
      {EVENT_KIND_LEGEND.map((item) => (
        <span key={item.key} className="flex items-center gap-1.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${item.dot}`} />
          {item.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-6 shrink-0 rounded bg-orange-500/60" />
        Пересечение по времени
      </span>
    </div>
  );
}
