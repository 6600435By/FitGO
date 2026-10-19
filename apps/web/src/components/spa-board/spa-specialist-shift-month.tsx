'use client';

import type { SpecialistAvailabilityBlock } from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SpaDayHoursDialog } from '@/components/spa-board/spa-day-hours-dialog';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function localDateKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeOf(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString('ru-RU', {
    month: 'long',
    year: 'numeric',
  });
}

/** Compact month of own published SPA shifts for the specialist schedule page. */
export function SpaSpecialistShiftMonth({
  onChanged,
}: {
  onChanged?: () => void | Promise<void>;
}) {
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [blocks, setBlocks] = useState<SpecialistAvailabilityBlock[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const end = new Date(year, month, 0, 23, 59, 59, 999);
    try {
      const cal = await api.specialistCalendar(
        token,
        start.toISOString(),
        end.toISOString(),
      );
      setBlocks(
        cal.availabilityBlocks.filter((b) => b.status === 'PUBLISHED'),
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка загрузки смен');
    }
  }, [month, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDate = useMemo(() => {
    const m = new Map<string, SpecialistAvailabilityBlock[]>();
    for (const b of blocks) {
      const key = localDateKey(b.startAt);
      const list = m.get(key) ?? [];
      list.push(b);
      m.set(key, list);
    }
    return m;
  }, [blocks]);

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = useMemo(() => {
    const dow = new Date(year, month - 1, 1).getDay();
    return dow === 0 ? 6 : dow - 1;
  }, [year, month]);

  const selectedBlocks = selectedDay
    ? byDate.get(selectedDay) ?? []
    : [];
  const selectedStart = selectedBlocks[0]
    ? timeOf(selectedBlocks[0].startAt)
    : undefined;
  const selectedEnd = selectedBlocks[0]
    ? timeOf(selectedBlocks[0].endAt)
    : undefined;

  const saveDay = async (payload: {
    startTime: string | null;
    endTime: string | null;
  }) => {
    if (!selectedDay) return;
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setMessage('');
    try {
      await api.specialistSetDayHours(token, {
        day: selectedDay,
        startTime: payload.startTime,
        endTime: payload.endTime,
      });
      setSelectedDay(null);
      setMessage('Смена сохранена');
      await load();
      await onChanged?.();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка сохранения');
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const prevMonth = () => {
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else setMonth((m) => m + 1);
  };

  return (
    <section className="card space-y-3">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 text-left"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="min-w-0">
          <span className="block font-medium">Мои смены</span>
          {!open ? (
            <span className="mt-1 block text-sm text-slate-400">
              {monthLabel(year, month)}
              {blocks.length
                ? ` · ${blocks.length} смен`
                : ' · нет опубликованных смен'}
            </span>
          ) : (
            <span className="mt-1 block text-sm text-slate-400">
              Опубликованные часы месяца. Нажмите день, чтобы изменить.
            </span>
          )}
        </span>
        <span className="shrink-0 pt-0.5 text-xs text-slate-500">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open ? (
        <>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className="btn-secondary !px-2.5 !py-1 text-xs"
              onClick={prevMonth}
            >
              ←
            </button>
            <span className="min-w-[8rem] text-center text-sm capitalize">
              {monthLabel(year, month)}
            </span>
            <button
              type="button"
              className="btn-secondary !px-2.5 !py-1 text-xs"
              onClick={nextMonth}
            >
              →
            </button>
          </div>

          {message ? (
            <p className="text-xs text-fitgo-300">{message}</p>
          ) : null}

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase text-slate-500">
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((l) => (
              <div key={l}>{l}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstWeekday }).map((_, i) => (
              <div key={`pad-${i}`} className="min-h-[3.25rem]" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const date = `${year}-${pad(month)}-${pad(day)}`;
              const dayBlocks = byDate.get(date) ?? [];
              const has = dayBlocks.length > 0;
              return (
                <button
                  key={date}
                  type="button"
                  className={`min-h-[3.25rem] rounded-lg border p-1 text-left transition ${
                    has
                      ? 'border-amber-500/40 bg-amber-500/10'
                      : 'border-white/5 bg-slate-950/40 hover:border-white/20'
                  }`}
                  onClick={() => setSelectedDay(date)}
                >
                  <span className="text-xs font-medium text-white">{day}</span>
                  {has ? (
                    <span className="mt-0.5 block text-[9px] tabular-nums text-amber-200/90">
                      {timeOf(dayBlocks[0]!.startAt)}–
                      {timeOf(dayBlocks[0]!.endAt)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      {selectedDay ? (
        <SpaDayHoursDialog
          key={`${selectedDay}-${selectedStart ?? 'off'}-${selectedEnd ?? 'off'}`}
          open
          dayLabel={new Date(`${selectedDay}T12:00:00`).toLocaleDateString(
            'ru-RU',
            {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            },
          )}
          initialStart={selectedStart}
          initialEnd={selectedEnd}
          busy={busy}
          onClose={() => setSelectedDay(null)}
          onSave={saveDay}
        />
      ) : null}
    </section>
  );
}
