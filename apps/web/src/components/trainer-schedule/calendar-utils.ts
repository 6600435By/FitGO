import type { TrainerCalendarEventKind } from '@fitgo/shared-types';

export type ScheduleTypeFilter = 'all' | 'group' | 'personal';

export function eventKindMatchesFilter(
  kind: TrainerCalendarEventKind,
  filter: ScheduleTypeFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'group') return kind === 'GROUP';
  return kind === 'PERSONAL' || kind === 'OPEN_SLOT' || kind === 'DRAFT_SLOT';
}
