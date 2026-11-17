'use client';

import type { TrainerCalendarEvent } from '@fitgo/shared-types';
import {
  eventRelationNote,
  eventSaleWaitTone,
  eventStateCaption,
} from './event-captions';
import {
  calendarEventBlockClass,
  calendarEventDotClass,
} from './event-kind-styles';

export function ScheduleMobileList({
  events,
  onSelectEvent,
  onManageEvent,
}: {
  events: TrainerCalendarEvent[];
  onSelectEvent?: (event: TrainerCalendarEvent) => void;
  onManageEvent?: (event: TrainerCalendarEvent) => void;
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
        const caption = eventStateCaption(event);
        const note = eventRelationNote(event);
        const waitTone = eventSaleWaitTone(event);
        const canManage =
          Boolean(onManageEvent) &&
          event.kind === 'PERSONAL' &&
          Boolean(event.bookingId);

        return (
          <li key={event.id}>
            {showHeader && (
              <p className="mb-2 mt-3 text-xs font-medium uppercase tracking-wide text-slate-500 first:mt-0">
                {day}
              </p>
            )}
            <div
              className={`card flex w-full items-stretch gap-2 ${calendarEventBlockClass(event)} border-l-4`}
            >
              <button
                type="button"
                onClick={() => onSelectEvent?.(event)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${calendarEventDotClass(event)}`}
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
                    <p
                      className={`mt-1 text-[10px] font-medium uppercase tracking-wide ${
                        waitTone === 'wait'
                          ? 'text-amber-300'
                          : 'opacity-80'
                      }`}
                    >
                      {caption}
                    </p>
                    {note ? (
                      <p className="mt-0.5 text-xs opacity-70">{note}</p>
                    ) : null}
                    {event.clientIssue && event.clientIssue !== 'NONE' ? (
                      <p className="mt-1 text-xs text-amber-300">
                        Клиент не в 1С
                      </p>
                    ) : null}
                  </div>
                </div>
              </button>
              {canManage ? (
                <button
                  type="button"
                  className="shrink-0 self-center px-2 text-xs font-medium text-forma-400 underline-offset-2 hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    onManageEvent?.(event);
                  }}
                >
                  Изменить
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
