'use client';

import {
  EVENT_KIND_LEGEND,
  eventDotClass,
  eventKindLabel,
} from './event-kind-styles';

export function ScheduleLegend() {
  const items = EVENT_KIND_LEGEND.filter((k) => k !== 'DRAFT_SLOT');

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-400">
      {items.map((kind) => (
        <span key={kind} className="flex items-center gap-1.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${eventDotClass(kind)}`} />
          {eventKindLabel(kind)}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-6 shrink-0 rounded bg-orange-500/60" />
        Пересечение по времени
      </span>
    </div>
  );
}
