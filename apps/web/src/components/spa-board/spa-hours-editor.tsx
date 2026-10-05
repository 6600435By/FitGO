'use client';

import type { SpecialistWorkSlotInput } from '@fitgo/shared-types';
import { formatDateTime } from '@/lib/utils';

/** Mon→Sun order for editing (UI); dayOfWeek stays JS 0=Sun … 6=Sat. */
const EDIT_DAYS: Array<{ dow: number; label: string }> = [
  { dow: 1, label: 'Пн' },
  { dow: 2, label: 'Вт' },
  { dow: 3, label: 'Ср' },
  { dow: 4, label: 'Чт' },
  { dow: 5, label: 'Пт' },
  { dow: 6, label: 'Сб' },
  { dow: 0, label: 'Вс' },
];

const DEFAULT_START = '10:00';
const DEFAULT_END = '20:00';

function slotsForDay(
  slots: SpecialistWorkSlotInput[],
  dow: number,
): SpecialistWorkSlotInput[] {
  return slots.filter((s) => s.dayOfWeek === dow);
}

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
  const setDayEnabled = (dow: number, enabled: boolean) => {
    const others = workSlots.filter((s) => s.dayOfWeek !== dow);
    if (!enabled) {
      onChange(others);
      return;
    }
    onChange([
      ...others,
      { dayOfWeek: dow, startTime: DEFAULT_START, endTime: DEFAULT_END },
    ]);
  };

  const updateDayTime = (
    dow: number,
    field: 'startTime' | 'endTime',
    value: string,
  ) => {
    const daySlots = slotsForDay(workSlots, dow);
    if (daySlots.length === 0) {
      onChange([
        ...workSlots,
        {
          dayOfWeek: dow,
          startTime: field === 'startTime' ? value : DEFAULT_START,
          endTime: field === 'endTime' ? value : DEFAULT_END,
        },
      ]);
      return;
    }
    let patched = false;
    onChange(
      workSlots.map((s) => {
        if (s.dayOfWeek !== dow || patched) return s;
        patched = true;
        return { ...s, [field]: value };
      }),
    );
  };

  const fillWeekdays = () => {
    const weekend = workSlots.filter(
      (s) => s.dayOfWeek === 0 || s.dayOfWeek === 6,
    );
    const weekdays: SpecialistWorkSlotInput[] = [1, 2, 3, 4, 5].map((dow) => {
      const existing = slotsForDay(workSlots, dow)[0];
      return (
        existing ?? {
          dayOfWeek: dow,
          startTime: DEFAULT_START,
          endTime: DEFAULT_END,
        }
      );
    });
    onChange([...weekdays, ...weekend]);
  };

  return (
    <section className="card space-y-4">
      <div>
        <h3 className="font-medium">Мой график (шаблон недели)</h3>
        <p className="mt-1 text-sm text-slate-400">
          Включите дни и укажите время. Затем сохраните шаблон и нажмите
          «Заполнить и опубликовать» — рабочие часы появятся на доске на 28
          дней.
        </p>
      </div>

      <ul className="space-y-2">
        {EDIT_DAYS.map(({ dow, label }) => {
          const daySlots = slotsForDay(workSlots, dow);
          const enabled = daySlots.length > 0;
          const slot = daySlots[0];
          return (
            <li
              key={dow}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2"
            >
              <label className="flex w-14 shrink-0 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={busy}
                  onChange={(e) => setDayEnabled(dow, e.target.checked)}
                />
                <span className="font-medium text-slate-200">{label}</span>
              </label>
              {enabled ? (
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  <input
                    type="time"
                    className="input w-auto py-1.5 text-sm"
                    value={slot?.startTime ?? DEFAULT_START}
                    disabled={busy}
                    onChange={(e) =>
                      updateDayTime(dow, 'startTime', e.target.value)
                    }
                  />
                  <span className="text-slate-500">–</span>
                  <input
                    type="time"
                    className="input w-auto py-1.5 text-sm"
                    value={slot?.endTime ?? DEFAULT_END}
                    disabled={busy}
                    onChange={(e) =>
                      updateDayTime(dow, 'endTime', e.target.value)
                    }
                  />
                </div>
              ) : (
                <span className="text-sm text-slate-500">выходной</span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary text-sm"
          disabled={busy}
          onClick={fillWeekdays}
        >
          Пн–Пт 10:00–20:00
        </button>
        <button
          type="button"
          className="btn-secondary text-sm"
          disabled={busy}
          onClick={onSaveTemplate}
        >
          Сохранить шаблон
        </button>
        <button
          type="button"
          className="btn-primary text-sm"
          disabled={busy || workSlots.length === 0}
          onClick={onFillAndPublish}
        >
          Заполнить и опубликовать (28 дн.)
        </button>
      </div>

      <ol className="list-decimal space-y-1 pl-4 text-xs text-slate-500">
        <li>Отметьте рабочие дни и время</li>
        <li>«Сохранить шаблон» — запомнить на будущее</li>
        <li>
          «Заполнить и опубликовать» — открыть запись на доске на ближайшие 28
          дней
        </li>
      </ol>

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
