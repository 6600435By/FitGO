import type { TrainerCalendarEventKind } from '@fitgo/shared-types';

const STYLES: Record<
  TrainerCalendarEventKind,
  { block: string; dot: string; label: string }
> = {
  GROUP: {
    block: 'border-l-4 border-blue-500 bg-blue-500/15 text-blue-50',
    dot: 'bg-blue-400',
    label: 'Групповое',
  },
  PERSONAL: {
    block: 'border-l-4 border-emerald-500 bg-emerald-500/20 text-emerald-50',
    dot: 'bg-emerald-400',
    label: 'Персональное',
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
    label: 'Запись вне дежурства',
  },
  DRAFT_SLOT: {
    block:
      'border-l-4 border-dashed border-amber-400/70 bg-amber-500/12 text-amber-100',
    dot: 'bg-amber-400',
    label: 'Черновик слота',
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

export function eventBlockClass(kind: TrainerCalendarEventKind): string {
  return STYLES[kind].block;
}

export function eventDotClass(kind: TrainerCalendarEventKind): string {
  return STYLES[kind].dot;
}

export function eventKindLabel(kind: TrainerCalendarEventKind): string {
  return STYLES[kind].label;
}

export const EVENT_KIND_LEGEND: TrainerCalendarEventKind[] = [
  'DUTY',
  'GROUP',
  'PERSONAL',
  'OPEN_SLOT',
  'DRAFT_SLOT',
  'HOLD_SLOT',
  'PERSONAL_BLOCK',
];
