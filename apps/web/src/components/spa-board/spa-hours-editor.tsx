'use client';

import type { SpecialistWorkSlotInput } from '@fitgo/shared-types';
import { formatDateTime } from '@/lib/utils';

const DAY_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export function SpaHoursEditor({
  workSlots,
  onChange,
  busy,
  draftBlockCount,
  lastPublicationAt,
  onSaveTemplate,
  onFillAndPublish,
}: {
  workSlots: SpecialistWorkSlotInput[];
  onChange: (slots: SpecialistWorkSlotInput[]) => void;
  busy?: boolean;
  draftBlockCount?: number;
  lastPublicationAt?: string;
  onSaveTemplate: () => void;
  onFillAndPublish: () => void;
}) {
  return (
    <section className="card space-y-3">
      <h3 className="font-medium">Шаблон недели</h3>
      <ul className="space-y-2 text-sm">
        {workSlots.map((slot, idx) => (
          <li
            key={`${slot.dayOfWeek}-${slot.startTime}-${idx}`}
            className="flex gap-2"
          >
            <span className="w-8 text-slate-400">
              {DAY_LABELS[slot.dayOfWeek]}
            </span>
            <span>
              {slot.startTime}–{slot.endTime}
            </span>
          </li>
        ))}
        {workSlots.length === 0 && (
          <li className="text-slate-400">Шаблон пуст — добавьте слоты</li>
        )}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() =>
            onChange([
              ...workSlots,
              { dayOfWeek: 1, startTime: '10:00', endTime: '20:00' },
            ])
          }
        >
          + Пн 10–20
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={onSaveTemplate}
        >
          Сохранить шаблон
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={onFillAndPublish}
        >
          Заполнить и опубликовать (28 дн.)
        </button>
      </div>
      {(draftBlockCount != null || lastPublicationAt) && (
        <p className="text-xs text-slate-500">
          {draftBlockCount != null ? `Черновиков: ${draftBlockCount}` : null}
          {lastPublicationAt
            ? `${draftBlockCount != null ? ' · ' : ''}последняя публикация ${formatDateTime(lastPublicationAt)}`
            : ''}
        </p>
      )}
    </section>
  );
}
