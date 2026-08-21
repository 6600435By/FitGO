'use client';

import type { TrainerCalendarEvent } from '@fitgo/shared-types';
import {
  eventBlockClass,
  eventDotClass,
  eventKindLabel,
} from './event-kind-styles';

export function ScheduleMobileList({
  events,
  onSelectEvent,
}: {
  events: TrainerCalendarEvent[];
  onSelectEvent?: (event: TrainerCalendarEvent) => void;
}) {
  const sorted = [...events].sort((a, b) => a.startAt.localeCompare(b.startAt));

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-slate-700/80 bg-slate-900/40 px-4 py-8 text-center text-sm text-slate-400">
        Нет событий в этом периоде
      </div>
    );
  }

  let lastDay = '';

  return (
    <ul className="space-y-2">
      {sorted.map((event) => {
        const day = new Date(event.startAt).toLocaleDateString('ru-RU', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        });
        const showHeader = day !== lastDay;
        lastDay = day;

        return (
          <li key={event.id}>
            {showHeader && (
              <p className="mb-2 mt-3 text-xs font-medium uppercase tracking-wide text-slate-500 first:mt-0">
                {day}
              </p>
            )}
            <button
              type="button"
              onClick={() => onSelectEvent?.(event)}
              className={`card w-full text-left ${eventBlockClass(event.kind)} border-l-4`}
            >
              <div className="flex items-start gap-2">
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${eventDotClass(event.kind)}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{event.title}</p>
                  <p className="mt-0.5 text-xs opacity-80">
                    {new Date(event.startAt).toLocaleTimeString('ru-RU', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {' — '}
                    {new Date(event.endAt).toLocaleTimeString('ru-RU', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-wide opacity-60">
                    {eventKindLabel(event.kind)}
                  </p>
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
