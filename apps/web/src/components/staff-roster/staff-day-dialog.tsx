'use client';

import type { StaffShiftDto } from '@fitgo/shared-types';
import { useEffect, useMemo, useState } from 'react';

type StaffOption = { id: string; name: string };

const WEEKDAY_BITS = [
  { bit: 1, label: 'Пн' }, // Mon
  { bit: 2, label: 'Вт' },
  { bit: 4, label: 'Ср' },
  { bit: 8, label: 'Чт' },
  { bit: 16, label: 'Пт' },
  { bit: 32, label: 'Сб' },
  { bit: 64, label: 'Вс' },
] as const;

/** JS getDay(): Sun=0 … Sat=6 → bit flags Mon=1 … Sun=64 */
function jsDayToBit(jsDay: number): number {
  if (jsDay === 0) return 64;
  return 1 << (jsDay - 1);
}

function datesInRange(
  from: string,
  to: string,
  weekdayMask: number,
): string[] {
  if (!from || !to || from > to) return [];
  const out: string[] = [];
  const cur = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (cur <= end) {
    const bit = jsDayToBit(cur.getDay());
    if (weekdayMask & bit) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      const d = String(cur.getDate()).padStart(2, '0');
      out.push(`${y}-${m}-${d}`);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function timeOf(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function FillPeriodForm({
  defaultFrom,
  defaultTo,
  busy,
  onSubmit,
  onCancel,
}: {
  defaultFrom: string;
  defaultTo: string;
  busy: boolean;
  onSubmit: (dates: string[]) => void;
  onCancel: () => void;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [mask, setMask] = useState(31); // Mon–Fri

  const preview = useMemo(() => datesInRange(from, to, mask), [from, to, mask]);

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
      <p className="text-xs text-slate-300">Период и дни недели</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-slate-400">
          С
          <input
            type="date"
            className="input mt-1 w-full"
            value={from}
            disabled={busy}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-xs text-slate-400">
          По
          <input
            type="date"
            className="input mt-1 w-full"
            value={to}
            disabled={busy}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-1">
        {WEEKDAY_BITS.map((w) => {
          const on = (mask & w.bit) !== 0;
          return (
            <button
              key={w.bit}
              type="button"
              disabled={busy}
              className={`rounded-md px-2 py-1 text-xs ${
                on
                  ? 'bg-emerald-500/25 text-emerald-200'
                  : 'bg-white/5 text-slate-400'
              }`}
              onClick={() =>
                setMask((prev) => (on ? prev & ~w.bit : prev | w.bit))
              }
            >
              {w.label}
            </button>
          );
        })}
        <button
          type="button"
          disabled={busy}
          className="rounded-md px-2 py-1 text-xs text-slate-400 underline"
          onClick={() => setMask(31)}
        >
          будни
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-md px-2 py-1 text-xs text-slate-400 underline"
          onClick={() => setMask(127)}
        >
          все
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Дней к заполнению: {preview.length}
        {preview.length > 0
          ? ` (${preview[0]}${preview.length > 1 ? ` … ${preview[preview.length - 1]}` : ''})`
          : ''}
      </p>
      <div className="flex gap-3 text-sm">
        <button
          type="button"
          className="text-emerald-300"
          disabled={busy || preview.length === 0}
          onClick={() => onSubmit(preview)}
        >
          Заполнить
        </button>
        <button
          type="button"
          className="text-slate-400"
          disabled={busy}
          onClick={onCancel}
        >
          Отмена
        </button>
      </div>
    </div>
  );
}

export function StaffDayDialog({
  date,
  shifts,
  staff,
  canEdit,
  busy,
  message,
  usedMinutes,
  capMinutes,
  intro,
  defaultStart,
  defaultEnd,
  allowOvertime,
  holiday,
  customHours,
  dayOpen,
  dayClose,
  dayClosed,
  onDayOpen,
  onDayClose,
  onDayClosed,
  onPatchDay,
  onClose,
  onSave,
  onDelete,
  onFill,
}: {
  date: string;
  shifts: StaffShiftDto[];
  staff: StaffOption[];
  canEdit: boolean;
  busy: boolean;
  message: string;
  usedMinutes: number;
  capMinutes: number;
  intro?: string;
  defaultStart: string;
  defaultEnd: string;
  allowOvertime: boolean;
  holiday: boolean;
  customHours: boolean;
  dayOpen: string;
  dayClose: string;
  dayClosed: boolean;
  onDayOpen: (value: string) => void;
  onDayClose: (value: string) => void;
  onDayClosed: (value: boolean) => void;
  onPatchDay: (body: {
    holiday?: boolean;
    hours?: { open: string; close: string; closed?: boolean } | null;
  }) => void;
  onClose: () => void;
  onSave: (input: {
    id?: string;
    userId: string;
    start: string;
    end: string;
    overtimeMinutes?: number;
  }) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
  onFill: (input: {
    userId: string;
    start: string;
    end: string;
    dates: string[];
    overtimeMinutes?: number;
  }) => Promise<boolean>;
}) {
  const [addUserId, setAddUserId] = useState('');
  const [addStart, setAddStart] = useState(defaultStart);
  const [addEnd, setAddEnd] = useState(defaultEnd);
  const [drafts, setDrafts] = useState<
    Record<string, { userId: string; start: string; end: string; overtimeMinutes: number }>
  >({});
  const [copyShiftId, setCopyShiftId] = useState<string | null>(null);
  const [showAddPeriod, setShowAddPeriod] = useState(false);

  const monthEnd = useMemo(() => {
    const [y, m] = date.split('-').map(Number);
    const last = new Date(y!, m!, 0).getDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  }, [date]);

  useEffect(() => {
    setAddStart(defaultStart);
    setAddEnd(defaultEnd);
  }, [defaultStart, defaultEnd, shifts.length]);

  const draftOf = (s: StaffShiftDto) =>
    drafts[s.id] ?? {
      userId: s.userId,
      start: timeOf(s.startAt),
      end: timeOf(s.endAt),
      overtimeMinutes: s.overtimeMinutes ?? 0,
    };

  const left = Math.max(0, capMinutes - usedMinutes);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onMouseDown={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-slate-950 p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">{date}</h2>
            <p className="text-sm text-slate-400">
              {(usedMinutes / 60).toFixed(1)} / {(capMinutes / 60).toFixed(1)} ч
              {left > 0 ? ` · свободно ${(left / 60).toFixed(1)} ч` : ' · лимит исчерпан'}
            </p>
            {intro && <p className="mt-1 text-xs text-slate-400">{intro}</p>}
          </div>
          <button type="button" className="text-sm text-slate-400" onClick={onClose}>
            Закрыть
          </button>
        </div>

        {message && <p className="mt-3 text-sm text-amber-300">{message}</p>}

        <ul className="mt-4 space-y-3">
          {shifts.length === 0 && (
            <li className="text-sm text-slate-500">В этот день пока никого нет</li>
          )}
          {shifts.map((s) => {
            const draft = draftOf(s);
            return (
              <li key={s.id} className="space-y-2 rounded-xl border border-white/10 p-3">
                <select
                  className="input w-full"
                  disabled={!canEdit || busy}
                  value={draft.userId}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [s.id]: { ...draft, userId: e.target.value },
                    }))
                  }
                >
                  {staff.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-slate-400">
                    С
                    <input
                      type="time"
                      className="input mt-1 w-full"
                      disabled={!canEdit || busy}
                      value={draft.start}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [s.id]: { ...draft, start: e.target.value },
                        }))
                      }
                    />
                  </label>
                  <label className="text-xs text-slate-400">
                    До
                    <input
                      type="time"
                      className="input mt-1 w-full"
                      disabled={!canEdit || busy}
                      value={draft.end}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [s.id]: { ...draft, end: e.target.value },
                        }))
                      }
                    />
                  </label>
                </div>
                {allowOvertime && (
                  <div className="space-y-1">
                    <p className="text-xs text-slate-400">
                      Закрыла позже — эти минуты в оплату, лимит дня не меняется
                    </p>
                    <div className="flex gap-2">
                      {[0, 15, 30].map((mins) => (
                        <button
                          key={mins}
                          type="button"
                          disabled={!canEdit || busy}
                          className={`rounded-lg px-2 py-1 text-xs ${
                            draft.overtimeMinutes === mins
                              ? 'bg-emerald-500/20 text-emerald-200'
                              : 'bg-white/5 text-slate-300'
                          }`}
                          onClick={async () => {
                            const ok = await onSave({
                              id: s.id,
                              userId: draft.userId,
                              start: draft.start,
                              end: draft.end,
                              overtimeMinutes: mins,
                            });
                            if (ok) {
                              setDrafts((prev) => {
                                const next = { ...prev };
                                delete next[s.id];
                                return next;
                              });
                            }
                          }}
                        >
                          {mins === 0 ? 'без задержки' : `+${mins} мин`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {canEdit && (
                  <div className="flex flex-wrap gap-3 text-sm">
                    <button
                      type="button"
                      className="text-emerald-300"
                      disabled={busy}
                      onClick={() =>
                        onSave({
                          id: s.id,
                          userId: draft.userId,
                          start: draft.start,
                          end: draft.end,
                          overtimeMinutes: draft.overtimeMinutes,
                        })
                      }
                    >
                      Сохранить
                    </button>
                    <button
                      type="button"
                      className="text-sky-300"
                      disabled={busy}
                      onClick={() =>
                        setCopyShiftId((id) => (id === s.id ? null : s.id))
                      }
                    >
                      {copyShiftId === s.id ? 'Скрыть копирование' : 'Скопировать на дни'}
                    </button>
                    <button
                      type="button"
                      className="text-red-300"
                      disabled={busy}
                      onClick={() => onDelete(s.id)}
                    >
                      Удалить
                    </button>
                  </div>
                )}
                {canEdit && copyShiftId === s.id && (
                  <FillPeriodForm
                    defaultFrom={date}
                    defaultTo={monthEnd}
                    busy={busy}
                    onCancel={() => setCopyShiftId(null)}
                    onSubmit={async (dates) => {
                      const ok = await onFill({
                        userId: draft.userId,
                        start: draft.start,
                        end: draft.end,
                        dates,
                        overtimeMinutes: draft.overtimeMinutes,
                      });
                      if (ok) setCopyShiftId(null);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>

        {canEdit && (
          <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
            <p className="text-sm text-white">Добавить сотрудника</p>
            <p className="text-xs text-slate-400">
              {left > 0
                ? `Время уже стоит на свободные ${(left / 60).toFixed(1)} ч. Полная вторая смена не влезет, если первая заняла почти весь лимит — сначала сократите её выше.`
                : 'Лимит дня занят. Сократите смену выше, потом добавьте ещё человека.'}
            </p>
            <select
              className="input w-full"
              value={addUserId}
              disabled={left === 0 && !showAddPeriod}
              onChange={(e) => setAddUserId(e.target.value)}
            >
              <option value="">Кто работает</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-400">
                С
                <input
                  type="time"
                  className="input mt-1 w-full"
                  value={addStart}
                  onChange={(e) => setAddStart(e.target.value)}
                />
              </label>
              <label className="text-xs text-slate-400">
                До
                <input
                  type="time"
                  className="input mt-1 w-full"
                  value={addEnd}
                  onChange={(e) => setAddEnd(e.target.value)}
                />
              </label>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={busy || !addUserId || left === 0}
                onClick={async () => {
                  const ok = await onSave({
                    userId: addUserId,
                    start: addStart,
                    end: addEnd,
                  });
                  if (ok) setAddUserId('');
                }}
              >
                Добавить в этот день
              </button>
              <button
                type="button"
                className="btn-secondary flex-1"
                disabled={busy || !addUserId}
                onClick={() => setShowAddPeriod((v) => !v)}
              >
                {showAddPeriod ? 'Скрыть период' : 'На период…'}
              </button>
            </div>
            {showAddPeriod && addUserId && (
              <FillPeriodForm
                defaultFrom={date}
                defaultTo={monthEnd}
                busy={busy}
                onCancel={() => setShowAddPeriod(false)}
                onSubmit={async (dates) => {
                  const ok = await onFill({
                    userId: addUserId,
                    start: addStart,
                    end: addEnd,
                    dates,
                  });
                  if (ok) {
                    setShowAddPeriod(false);
                    setAddUserId('');
                  }
                }}
              />
            )}
          </div>
        )}

        {canEdit && (
          <details className="mt-4 border-t border-white/10 pt-3 text-sm">
            <summary className="cursor-pointer text-slate-300">
              Часы клуба в этот день
              {holiday ? ' · праздник' : ''}
              {customHours ? ' · свои часы' : ''}
            </summary>
            <div className="mt-3 space-y-3">
              <label className="flex items-center gap-2 text-slate-300">
                <input
                  type="checkbox"
                  checked={holiday}
                  disabled={busy}
                  onChange={(e) => onPatchDay({ holiday: e.target.checked })}
                />
                Праздник (часы и лимит как в выходной)
              </label>
              <label className="flex items-center gap-2 text-slate-300">
                <input
                  type="checkbox"
                  checked={dayClosed}
                  disabled={busy}
                  onChange={(e) => onDayClosed(e.target.checked)}
                />
                Клуб закрыт
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-slate-400">
                  Открытие
                  <input
                    type="time"
                    className="input mt-1 w-full"
                    disabled={busy || dayClosed}
                    value={dayOpen}
                    onChange={(e) => onDayOpen(e.target.value)}
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Закрытие
                  <input
                    type="time"
                    className="input mt-1 w-full"
                    disabled={busy || dayClosed}
                    value={dayClose}
                    onChange={(e) => onDayClose(e.target.value)}
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="text-emerald-300"
                  disabled={busy}
                  onClick={() =>
                    onPatchDay({
                      hours: { open: dayOpen, close: dayClose, closed: dayClosed },
                    })
                  }
                >
                  Сохранить часы дня
                </button>
                {customHours && (
                  <button
                    type="button"
                    className="text-slate-400"
                    disabled={busy}
                    onClick={() => onPatchDay({ hours: null })}
                  >
                    Как в шаблоне недели
                  </button>
                )}
              </div>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
