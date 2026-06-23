import type { TrainerCalendarEventKind } from '@fitgo/shared-types';
import type { CSSProperties } from 'react';

export type ScheduleTypeFilter = 'all' | 'group' | 'personal';

export function eventKindMatchesFilter(
  kind: TrainerCalendarEventKind,
  filter: ScheduleTypeFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'group') return kind === 'GROUP';
  return kind === 'PERSONAL' || kind === 'OPEN_SLOT' || kind === 'DRAFT_SLOT';
}

export function calendarEventStyle(kind: TrainerCalendarEventKind): {
  className: string;
  style: CSSProperties;
} {
  switch (kind) {
    case 'GROUP':
      return {
        className: 'border border-blue-400/40',
        style: { backgroundColor: 'rgba(59, 130, 246, 0.35)' },
      };
    case 'PERSONAL':
      return {
        className: 'border border-emerald-400/40',
        style: { backgroundColor: 'rgba(16, 185, 129, 0.45)' },
      };
    case 'OPEN_SLOT':
      return {
        className: 'border border-dashed border-emerald-400/60',
        style: { backgroundColor: 'rgba(16, 185, 129, 0.12)' },
      };
    case 'DRAFT_SLOT':
      return {
        className: 'border border-dashed border-amber-400/50',
        style: { backgroundColor: 'rgba(245, 158, 11, 0.12)' },
      };
    default:
      return {
        className: '',
        style: { backgroundColor: 'rgba(100, 116, 139, 0.3)' },
      };
  }
}
