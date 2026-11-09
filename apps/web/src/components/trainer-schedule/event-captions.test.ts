/**
 * Run: cd apps/web && npx tsx --test src/components/trainer-schedule/event-captions.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TrainerCalendarEvent } from '@fitgo/shared-types';
import {
  eventRelationNote,
  eventStateCaption,
  isCancelledCalendarEvent,
} from './event-captions';
import { eventVisibleInCalendar } from './calendar-utils';

function ev(
  partial: Partial<TrainerCalendarEvent> &
    Pick<TrainerCalendarEvent, 'kind' | 'title' | 'startAt' | 'endAt'>,
): TrainerCalendarEvent {
  return {
    id: partial.id ?? 'e1',
    ...partial,
  };
}

describe('eventStateCaption', () => {
  it('labels the six acceptance states with text', () => {
    assert.equal(
      eventStateCaption(
        ev({
          kind: 'DUTY',
          title: 'Дежурство',
          startAt: '2026-11-10T09:00:00.000Z',
          endAt: '2026-11-10T17:00:00.000Z',
        }),
      ),
      'Дежурство',
    );
    assert.equal(
      eventStateCaption(
        ev({
          kind: 'DRAFT_SLOT',
          title: 'Черновик',
          startAt: '2026-11-10T18:00:00.000Z',
          endAt: '2026-11-10T19:00:00.000Z',
        }),
      ),
      'Черновик',
    );
    assert.equal(
      eventStateCaption(
        ev({
          kind: 'OPEN_SLOT',
          title: 'Свободно',
          startAt: '2026-11-10T18:00:00.000Z',
          endAt: '2026-11-10T19:00:00.000Z',
        }),
      ),
      'Свободно',
    );
    assert.equal(
      eventStateCaption(
        ev({
          kind: 'PERSONAL',
          title: 'ПТ',
          startAt: '2026-11-10T10:00:00.000Z',
          endAt: '2026-11-10T11:00:00.000Z',
          bookingStatus: 'CONFIRMED',
        }),
      ),
      'Запись',
    );
    assert.equal(
      eventStateCaption(
        ev({
          kind: 'PERSONAL',
          title: 'Отмена',
          startAt: '2026-11-10T10:00:00.000Z',
          endAt: '2026-11-10T11:00:00.000Z',
          bookingStatus: 'CANCELLED',
        }),
      ),
      'Отмена',
    );
    assert.equal(
      eventStateCaption(
        ev({
          kind: 'PERSONAL',
          title: 'ПТ',
          startAt: '2026-11-10T10:00:00.000Z',
          endAt: '2026-11-10T11:00:00.000Z',
          bookingStatus: 'CONFIRMED',
          outsideShift: true,
        }),
      ),
      'Вне смены · разрешено',
    );
  });

  it('explains cancel/series only from stored fields', () => {
    assert.equal(
      eventRelationNote(
        ev({
          kind: 'PERSONAL',
          title: 'Отмена',
          startAt: '2026-11-10T10:00:00.000Z',
          endAt: '2026-11-10T11:00:00.000Z',
          bookingStatus: 'CANCELLED',
          cancelReason: 'Клиент заболел',
        }),
      ),
      'Клиент заболел',
    );
    assert.equal(
      eventRelationNote(
        ev({
          kind: 'PERSONAL',
          title: 'Отмена',
          startAt: '2026-11-10T10:00:00.000Z',
          endAt: '2026-11-10T11:00:00.000Z',
          bookingStatus: 'CANCELLED',
          seriesId: 'ser1',
        }),
      ),
      'Серия: слот отменён, повторно не создаётся',
    );
    assert.equal(
      eventRelationNote(
        ev({
          kind: 'OPEN_SLOT',
          title: 'Свободно',
          startAt: '2026-11-10T18:00:00.000Z',
          endAt: '2026-11-10T19:00:00.000Z',
        }),
      ),
      'опубликовано',
    );
  });
});

describe('eventVisibleInCalendar', () => {
  const cancelled = ev({
    kind: 'PERSONAL',
    title: 'Отмена',
    startAt: '2026-11-10T10:00:00.000Z',
    endAt: '2026-11-10T11:00:00.000Z',
    bookingStatus: 'CANCELLED',
  });
  const draft = ev({
    kind: 'DRAFT_SLOT',
    title: 'Черновик',
    startAt: '2026-11-10T18:00:00.000Z',
    endAt: '2026-11-10T19:00:00.000Z',
  });

  it('hides cancellations by default and shows drafts', () => {
    assert.equal(eventVisibleInCalendar(cancelled, 'all', false), false);
    assert.equal(eventVisibleInCalendar(cancelled, 'all', true), true);
    assert.equal(eventVisibleInCalendar(draft, 'personal', false), true);
    assert.equal(isCancelledCalendarEvent(cancelled), true);
  });
});
