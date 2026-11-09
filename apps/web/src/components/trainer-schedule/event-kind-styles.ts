import type { TrainerCalendarEvent, TrainerCalendarEventKind } from '@fitgo/shared-types';

function isCancelled(event: TrainerCalendarEvent): boolean {
  return event.bookingStatus === 'CANCELLED';
}

const STYLES: Record<
  TrainerCalendarEventKind,
  { block: string; dot: string; label: string }
> = {
  GROUP: {
    block: 'border-l-4 border-blue-500 bg-blue-500/15 text-blue-50',
    dot: 'bg-blue-400',
    label: 'Запись',
  },
  PERSONAL: {
    block: 'border-l-4 border-emerald-500 bg-emerald-500/20 text-emerald-50',
    dot: 'bg-emerald-400',
    label: 'Запись',
  },
  DUTY: {
    block: 'border-l-4 border-sky-400 bg-sky-500/20 text-sky-50',
    dot: 'bg-sky-300',
    label: 'Дежурство',
  },
  OPEN_SLOT: {
    block:
      'border-l-4 border-dashed border-emerald-400/70 bg-emerald-500/8 text-emerald-200',
    dot: 'bg-emerald-300/80',
    label: 'Свободно',
  },
  DRAFT_SLOT: {
    block:
      'border-l-4 border-dashed border-amber-400/70 bg-amber-500/12 text-amber-100',
    dot: 'bg-amber-400',
    label: 'Черновик',
  },
  HOLD_SLOT: {
    block:
      'border-l-4 border-yellow-400 bg-yellow-500/15 text-yellow-50 outline outline-1 outline-yellow-400/60',
    dot: 'bg-yellow-400',
    label: 'Резерв',
  },
  PERSONAL_BLOCK: {
    block: 'border-l-4 border-slate-500 bg-slate-500/25 text-slate-100',
    dot: 'bg-slate-400',
    label: 'Блокировка',
  },
};

const CANCELLED_BLOCK =
  'border-l-4 border-dashed border-rose-400/70 bg-rose-500/10 text-rose-100/90 line-through decoration-rose-300/50';
const CANCELLED_DOT = 'bg-rose-400';

export function eventBlockClass(kind: TrainerCalendarEventKind): string {
  return STYLES[kind].block;
}

export function eventDotClass(kind: TrainerCalendarEventKind): string {
  return STYLES[kind].dot;
}

export function eventKindLabel(kind: TrainerCalendarEventKind): string {
  return STYLES[kind].label;
}

/** Block classes for a concrete calendar event (handles cancelled bookings). */
export function calendarEventBlockClass(event: TrainerCalendarEvent): string {
  if (isCancelled(event)) return CANCELLED_BLOCK;
  return eventBlockClass(event.kind);
}

export function calendarEventDotClass(event: TrainerCalendarEvent): string {
  if (isCancelled(event)) return CANCELLED_DOT;
  return eventDotClass(event.kind);
}

export const EVENT_KIND_LEGEND: Array<{
  key: string;
  label: string;
  dot: string;
}> = [
  { key: 'DUTY', label: 'Дежурство', dot: STYLES.DUTY.dot },
  { key: 'BOOKING', label: 'Запись', dot: STYLES.PERSONAL.dot },
  { key: 'OPEN_SLOT', label: 'Свободно', dot: STYLES.OPEN_SLOT.dot },
  { key: 'DRAFT_SLOT', label: 'Черновик', dot: STYLES.DRAFT_SLOT.dot },
  { key: 'OUTSIDE', label: 'Вне смены · разрешено', dot: 'bg-violet-400' },
  { key: 'CANCELLED', label: 'Отмена', dot: CANCELLED_DOT },
  { key: 'HOLD_SLOT', label: 'Резерв', dot: STYLES.HOLD_SLOT.dot },
  {
    key: 'PERSONAL_BLOCK',
    label: 'Блокировка',
    dot: STYLES.PERSONAL_BLOCK.dot,
  },
];
