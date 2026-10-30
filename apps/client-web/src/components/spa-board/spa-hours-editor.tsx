'use client';

import type { SpecialistWorkSlotInput } from '@fitgo/shared-types';
import { useState } from 'react';
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

/** Keep HH:MM even when the browser emits HH:MM:SS. */
export function normalizeHm(raw: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(raw.trim());
  if (!m) return raw;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function slotsForDay(
  slots: SpecialistWorkSlotInput[],
  dow: number,
): SpecialistWorkSlotInput[] {
  return slots.filter((s) => s.dayOfWeek === dow);
}

function templateSummary(slots: SpecialistWorkSlotInput[]): string {
  const enabled = EDIT_DAYS.filter(({ dow }) =>
    slots.some((s) => s.dayOfWeek === dow),
  );
  if (enabled.length === 0) return 'Не задан — откройте и укажите дни';
  return enabled
    .map(({ dow, label }) => {
      const slot = slots.find((s) => s.dayOfWeek === dow);
      return slot ? `${label} ${slot.startTime}–${slot.endTime}` : label;
    })
    .join(' · ');
}

export function SpaHoursEditor({
  workSlots,
  onChange,
  busy,
  draftBlockCount,
  lastPublicationAt,
  onSaveTemplate,
  onFillAndPublish,
  title = 'Мой график (шаблон недели)',
}: {
  workSlots: SpecialistWorkSlotInput[];
  onChange: (slots: SpecialistWorkSlotInput[]) => void;
  busy?: boolean;
  draftBlockCount?: number;
  lastPublicationAt?: string;
  onSaveTemplate: () => void;
  onFillAndPublish: () => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);

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
    const hm = normalizeHm(value);
    const daySlots = slotsForDay(workSlots, dow);
    if (daySlots.length === 0) {
      onChange([
        ...workSlots,
        {
          dayOfWeek: dow,
          startTime: field === 'startTime' ? hm : DEFAULT_START,
          endTime: field === 'endTime' ? hm : DEFAULT_END,
        },
      ]);
      return;
    }
    let patched = false;
    onChange(
      workSlots.map((s) => {
        if (s.dayOfWeek !== dow || patched) return s;
        patched = true;
        return { ...s, [field]: hm };
      }),
    );
  };

  return (
    <section className="card space-y-4">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 text-left"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="min-w-0">
          <span className="block font-medium">{title}</span>
          {!open ? (
            <span className="mt-1 block text-sm text-slate-400">
              {templateSummary(workSlots)}
            </span>
          ) : (
            <span className="mt-1 block text-sm text-slate-400">
              Отметьте рабочие дни и время — это шаблон. Сохраните его или сразу
              опубликуйте на ближайшие 28 дней. Часы на один день меняйте кнопкой
              «Часы дня» в журнале выше.
            </span>
          )}
        </span>
        <span className="shrink-0 pt-0.5 text-xs text-slate-500">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open ? (
        <>
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
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <input
                        type="time"
                        className="input w-[5.6rem] shrink-0 px-2 py-1.5 text-sm"
                        value={slot?.startTime ?? DEFAULT_START}
                        disabled={busy}
                        onChange={(e) =>
                          updateDayTime(dow, 'startTime', e.target.value)
                        }
                      />
                      <span className="shrink-0 text-slate-500">–</span>
                      <input
                        type="time"
                        className="input w-[5.6rem] shrink-0 px-2 py-1.5 text-sm"
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

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={busy || workSlots.length === 0}
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
              Сохранить и опубликовать (28 дн.)
            </button>
          </div>

          <p className="text-xs text-slate-500">
            «Сохранить шаблон» — только запомнить дни/время. «Сохранить и
            опубликовать» — записать шаблон и открыть эти часы на доске на 28
            дней.
          </p>

          {(draftBlockCount != null || lastPublicationAt) && (
            <p className="text-xs text-slate-500">
              {draftBlockCount != null ? `Черновиков: ${draftBlockCount}` : null}
              {lastPublicationAt
                ? `${draftBlockCount != null ? ' · ' : ''}последняя публикация ${formatDateTime(lastPublicationAt)}`
                : ''}
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
