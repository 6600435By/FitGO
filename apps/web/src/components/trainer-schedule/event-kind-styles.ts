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
  OPEN_SLOT: {
    block:
      'border-l-4 border-dashed border-emerald-400/70 bg-emerald-500/8 text-emerald-200',
    dot: 'bg-emerald-300/80',
    label: 'Открыто для записи',
  },
  DRAFT_SLOT: {
    block:
      'border-l-4 border-dashed border-amber-400/70 bg-amber-500/12 text-amber-100',
    dot: 'bg-amber-400',
    label: 'Черновик слота',
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
  'GROUP',
  'PERSONAL',
  'OPEN_SLOT',
  'DRAFT_SLOT',
];
