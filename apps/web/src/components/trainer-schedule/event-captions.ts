import type { TrainerCalendarEvent } from '@fitgo/shared-types';
import { eventKindLabel } from './event-kind-styles';

/** Short state label — never rely on colour alone. */
export function eventStateCaption(event: TrainerCalendarEvent): string {
  if (event.bookingStatus === 'CANCELLED') return 'Отмена';
  if (event.kind === 'DRAFT_SLOT') return 'Черновик';
  if (event.kind === 'OPEN_SLOT') return 'Свободно';
  if (event.kind === 'DUTY') return 'Дежурство';
  if (event.kind === 'HOLD_SLOT') return eventKindLabel('HOLD_SLOT');
  if (event.kind === 'PERSONAL_BLOCK') return eventKindLabel('PERSONAL_BLOCK');
  if (event.kind === 'GROUP' || event.kind === 'PERSONAL') {
    if (event.outsideShift) return 'Вне смены · разрешено';
    return 'Запись';
  }
  return eventKindLabel(event.kind);
}

/** Extra line under the state caption when data explains the link. */
export function eventRelationNote(event: TrainerCalendarEvent): string | null {
  if (event.bookingStatus === 'CANCELLED' && event.cancelReason?.trim()) {
    return event.cancelReason.trim();
  }
  if (event.bookingStatus === 'CANCELLED' && event.seriesId) {
    return 'Серия: слот отменён, повторно не создаётся';
  }
  if (event.seriesId && event.bookingStatus !== 'CANCELLED') {
    return 'Серия';
  }
  if (event.kind === 'OPEN_SLOT') {
    return 'опубликовано';
  }
  return null;
}

export function isCancelledCalendarEvent(event: TrainerCalendarEvent): boolean {
  return event.bookingStatus === 'CANCELLED';
}

/** Day without admin duty / published hours that still has a live booking. */
export const DAY_OFF_WITH_BOOKING_POLICY =
  'Нет смены администратора. Запись вне смены разрешена.';
