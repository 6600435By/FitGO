import type { TrainerCalendarEventKind } from '@fitgo/shared-types';
import type { TrainerCalendarEvent } from '@fitgo/shared-types';
import { isCancelledCalendarEvent } from './event-captions';

export type ScheduleTypeFilter = 'all' | 'group' | 'personal';

export function eventKindMatchesFilter(
  kind: TrainerCalendarEventKind,
  filter: ScheduleTypeFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'group') return kind === 'GROUP';
  return (
    kind === 'PERSONAL' ||
    kind === 'DUTY' ||
    kind === 'OPEN_SLOT' ||
    kind === 'DRAFT_SLOT' ||
    kind === 'HOLD_SLOT' ||
    kind === 'PERSONAL_BLOCK'
  );
}

/** Default calendar feed: hide cancelled unless the «Отмены» toggle is on. */
export function eventVisibleInCalendar(
  event: TrainerCalendarEvent,
  filter: ScheduleTypeFilter,
  showCancelled: boolean,
): boolean {
  if (isCancelledCalendarEvent(event) && !showCancelled) return false;
  return eventKindMatchesFilter(event.kind, filter);
}
