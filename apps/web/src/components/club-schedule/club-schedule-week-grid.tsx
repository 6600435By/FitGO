'use client';

import type { ClubScheduleEvent } from '@fitgo/shared-types';
import {
  sessionClockPhase,
  sessionResultPendingFromPhase,
  sessionStateExplainRu,
} from '@fitgo/shared-types';
import { format, getDay, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { MutableRefObject } from 'react';
import { cn } from '@/lib/utils';

const TYPE_LABEL: Record<string, string> = {
  GROUP: 'ГП',
  PT: 'ПТ',
  SPA: 'SPA',
  DUTY: 'Деж.',
};

const TYPE_BORDER: Record<string, string> = {
  GROUP: 'border-l-fitgo-500',
  PT: 'border-l-violet-500',
  SPA: 'border-l-amber-500',
  DUTY: 'border-l-slate-500',
};

const TYPE_BADGE: Record<string, string> = {
  GROUP: 'bg-fitgo-500/15 text-fitgo-300',
  PT: 'bg-violet-500/15 text-violet-300',
  SPA: 'bg-amber-500/15 text-amber-300',
  DUTY: 'bg-slate-500/20 text-slate-300',
};

function isPendingConfirmation(ev: ClubScheduleEvent): boolean {
  const phase = ev.approvalPhase;
  if (
    phase !== 'PENDING_ADMIN' &&
    phase !== 'PENDING_TRAINER' &&
    phase !== 'PENDING_PERFORMER'
  ) {
    return false;
  }
  return Boolean(ev.sessionKey);
}

function scheduleEventStateLabel(ev: ClubScheduleEvent): string {
  const clock = sessionClockPhase({
    startAt: ev.startAt,
    endAt: ev.endAt,
    cancelled: ev.status === 'cancelled',
  });
  const result = sessionResultPendingFromPhase(ev.approvalPhase);
  if (clock === 'ELAPSED' || result !== 'none') {
    return sessionStateExplainRu({ clock, result });
  }
  return ev.approvalLabel || ev.status;
}

function WeekEventChip({
  ev,
  isTrainer,
  onOpen,
}: {
  ev: ClubScheduleEvent;
  isTrainer: boolean;
  onOpen: (ev: ClubScheduleEvent) => void;
}) {
  const clickable = Boolean(ev.sessionKey);
  const pending = isPendingConfirmation(ev);
  const cancelled = ev.status === 'cancelled';
  const person = isTrainer
    ? ev.clientName
    : ev.clientName || ev.staffName;
  const occupancy =
    ev.booked != null
      ? `${ev.booked}${ev.capacity != null ? `/${ev.capacity}` : ''}`
      : null;
  const state = scheduleEventStateLabel(ev);

  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => onOpen(ev)}
      title={`${ev.title} · ${state}`}
      className={cn(
        'w-full rounded-lg border border-slate-800/80 border-l-[3px] bg-slate-950/70 px-2 py-1.5 text-left transition',
        TYPE_BORDER[ev.type] ?? 'border-l-slate-600',
        clickable
          ? 'cursor-pointer hover:border-fitgo-500/40 hover:bg-slate-900/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fitgo-500/50'
          : 'cursor-default opacity-90',
        pending && 'ring-1 ring-amber-500/35',
        cancelled && 'opacity-55',
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="tabular-nums text-[11px] font-medium text-slate-200">
          {format(parseISO(ev.startAt), 'HH:mm')}–
          {format(parseISO(ev.endAt), 'HH:mm')}
        </span>
        <span
          className={cn(
            'shrink-0 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide',
            TYPE_BADGE[ev.type] ?? 'bg-slate-700 text-slate-300',
          )}
        >
          {TYPE_LABEL[ev.type] ?? ev.type}
        </span>
      </div>
      <p className="mt-0.5 line-clamp-2 text-[11px] font-medium leading-snug text-slate-100">
        {ev.title}
      </p>
      <p className="mt-0.5 truncate text-[10px] leading-snug text-slate-500">
        {[person, occupancy, state].filter(Boolean).join(' · ')}
        {ev.payrollLocked ? ' · ЗП' : ''}
      </p>
    </button>
  );
}

export function ClubScheduleWeekGrid({
  days,
  eventsByDay,
  anchorDay,
  todayStr,
  isTrainer,
  onSelectDay,
  onOpenEvent,
  dayColumnRefs,
}: {
  days: Date[];
  eventsByDay: Map<string, ClubScheduleEvent[]>;
  anchorDay: string;
  todayStr: string;
  isTrainer: boolean;
  onSelectDay: (dayKey: string) => void;
  onOpenEvent: (ev: ClubScheduleEvent) => void;
  dayColumnRefs: MutableRefObject<Record<string, HTMLElement | null>>;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-fitgo-500" /> ГП
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-violet-500" /> ПТ
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-amber-500" /> SPA
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-slate-500" /> Дежурство
        </span>
        <span className="inline-flex items-center gap-1.5 text-amber-500/80">
          <span className="h-2 w-2 rounded-sm ring-1 ring-amber-500/50" /> ждут
          подтверждения
        </span>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="flex overflow-x-auto lg:grid lg:grid-cols-7 lg:overflow-visible">
          {days.map((d, index) => {
            const key = format(d, 'yyyy-MM-dd');
            const dayEvents = eventsByDay.get(key) ?? [];
            const isToday = key === todayStr;
            const isAnchor = key === anchorDay;
            const weekday = getDay(d);
            const isWeekend = weekday === 0 || weekday === 6;

            return (
              <section
                key={key}
                ref={(el) => {
                  dayColumnRefs.current[key] = el;
                }}
                className={cn(
                  'flex min-w-[9.5rem] flex-1 flex-col border-slate-800/80 lg:min-w-0',
                  index < days.length - 1 && 'border-r',
                  isToday && 'bg-fitgo-500/[0.04]',
                  !isToday && isAnchor && 'bg-slate-900/40',
                  !isToday && !isAnchor && isWeekend && 'bg-slate-950/50',
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectDay(key)}
                  className={cn(
                    'sticky top-0 z-[1] flex w-full flex-col items-center gap-0.5 border-b border-slate-800/80 px-1.5 py-2 text-center backdrop-blur-sm',
                    isToday
                      ? 'bg-fitgo-500/10 text-fitgo-300'
                      : 'bg-slate-950/90 text-slate-300',
                  )}
                >
                  <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    {format(d, 'EEEEEE', { locale: ru })}
                  </span>
                  <span
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums',
                      isToday &&
                        'bg-fitgo-500 text-slate-950 shadow-sm shadow-fitgo-500/30',
                      !isToday && isAnchor && 'bg-slate-800 text-slate-100',
                    )}
                  >
                    {format(d, 'd')}
                  </span>
                  <span className="text-[10px] tabular-nums text-slate-500">
                    {dayEvents.length
                      ? `${dayEvents.length} зан.`
                      : '·'}
                  </span>
                </button>

                <div className="flex max-h-[min(70vh,44rem)] flex-col gap-1.5 overflow-y-auto p-1.5">
                  {dayEvents.length === 0 ? (
                    <p className="px-1 py-3 text-center text-[10px] text-slate-600">
                      нет занятий
                    </p>
                  ) : (
                    dayEvents.map((ev) => (
                      <WeekEventChip
                        key={`${ev.type}-${ev.id}`}
                        ev={ev}
                        isTrainer={isTrainer}
                        onOpen={onOpenEvent}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
