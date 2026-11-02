'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  getMonth,
  getYear,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  setMonth,
  setYear,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

const POPOVER_WIDTH_PX = 280; // w-[17.5rem]
const POPOVER_EST_HEIGHT_PX = 340;
const POPOVER_GAP_PX = 6;
const VIEWPORT_PAD_PX = 8;

export type DateFieldProps = {
  /** Field caption above the trigger. Omit or pass "" to hide. */
  label?: string;
  value: string; // YYYY-MM-DD
  onChange: (next: string) => void;
  className?: string;
  /** Extra classes on the trigger button (width, height tweaks). */
  inputClassName?: string;
  min?: string; // YYYY-MM-DD inclusive
  max?: string; // YYYY-MM-DD inclusive
  disabled?: boolean;
  required?: boolean;
  align?: 'left' | 'right';
  /**
   * When value is empty, open calendar on this year (e.g. 1995 for birth date).
   * Month defaults to January unless `initialMonth` is set (0–11).
   */
  initialYear?: number;
  /** 0–11; used with `initialYear` when value is empty. */
  initialMonth?: number;
};

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: i,
  label: format(new Date(2020, i, 1), 'LLLL', { locale: ru }),
}));

function toIsoDate(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

function inRange(iso: string, min?: string, max?: string): boolean {
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
}

export type TimeFieldProps = {
  label?: string;
  /** HH:mm */
  value: string;
  onChange: (next: string) => void;
  className?: string;
  disabled?: boolean;
  /** Narrow hour/minute selects for dense rows. */
  compact?: boolean;
};

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, '0'),
);
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, '0'),
);

function splitHm(value: string): { hour: string; minute: string } {
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return { hour: '10', minute: '00' };
  const hour = String(Math.min(23, Math.max(0, Number(m[1])))).padStart(2, '0');
  const minute = String(Math.min(59, Math.max(0, Number(m[2])))).padStart(
    2,
    '0',
  );
  return { hour, minute };
}

/**
 * Hour/minute selects — reliable on Android Chrome where native
 * `input type="time"` often blocks segment edits inside fixed-height .input.
 */
export function TimeField({
  label,
  value,
  onChange,
  className,
  disabled,
  compact,
}: TimeFieldProps) {
  const { hour, minute } = splitHm(value || '10:00');
  const selectClass = compact
    ? 'input !px-1 !py-1 text-xs tabular-nums'
    : 'input';
  return (
    <label className={`block space-y-1 text-sm ${className ?? ''}`}>
      {label ? (
        <span className="block h-4 text-[11px] text-slate-500">{label}</span>
      ) : null}
      <div
        className={`grid grid-cols-2 ${compact ? 'gap-1' : 'gap-1.5'}`}
      >
        <select
          className={selectClass}
          aria-label="Часы"
          disabled={disabled}
          value={hour}
          onChange={(e) => onChange(`${e.target.value}:${minute}`)}
        >
          {HOUR_OPTIONS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          aria-label="Минуты"
          disabled={disabled}
          value={minute}
          onChange={(e) => onChange(`${hour}:${e.target.value}`)}
        >
          {MINUTE_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

function defaultCursor(
  value: string,
  initialYear?: number,
  initialMonth?: number,
): Date {
  if (value) return startOfMonth(parseISO(value));
  if (initialYear != null) {
    const m = initialMonth ?? 0;
    return startOfMonth(new Date(initialYear, m, 1));
  }
  return startOfMonth(new Date());
}

/** FitGO date picker — etalon from Super Admin «Нестыковки» → Свой.
 * Popover is portaled to `document.body` so it is not clipped by
 * `overflow-hidden` ancestors (e.g. PayrollFold cards).
 */
export function DateField({
  label,
  value,
  onChange,
  className,
  inputClassName,
  min,
  max,
  disabled,
  required,
  align = 'left',
  initialYear,
  initialMonth,
}: DateFieldProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const selected = value ? parseISO(value) : new Date();
  const [cursor, setCursor] = useState(() =>
    defaultCursor(value, initialYear, initialMonth),
  );

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left =
      align === 'right' ? r.right - POPOVER_WIDTH_PX : r.left;
    if (left < VIEWPORT_PAD_PX) left = VIEWPORT_PAD_PX;
    if (left + POPOVER_WIDTH_PX > window.innerWidth - VIEWPORT_PAD_PX) {
      left = window.innerWidth - VIEWPORT_PAD_PX - POPOVER_WIDTH_PX;
    }
    const spaceBelow = window.innerHeight - r.bottom - VIEWPORT_PAD_PX;
    const spaceAbove = r.top - VIEWPORT_PAD_PX;
    const openAbove =
      spaceBelow < POPOVER_EST_HEIGHT_PX && spaceAbove > spaceBelow;
    let top = openAbove
      ? r.top - POPOVER_GAP_PX - POPOVER_EST_HEIGHT_PX
      : r.bottom + POPOVER_GAP_PX;
    if (top < VIEWPORT_PAD_PX) top = VIEWPORT_PAD_PX;
    if (top + POPOVER_EST_HEIGHT_PX > window.innerHeight - VIEWPORT_PAD_PX) {
      top = Math.max(
        VIEWPORT_PAD_PX,
        window.innerHeight - VIEWPORT_PAD_PX - POPOVER_EST_HEIGHT_PX,
      );
    }
    setCoords({ top, left });
  }, [align]);

  useEffect(() => {
    if (open) setCursor(defaultCursor(value, initialYear, initialMonth));
  }, [open, value, initialYear, initialMonth]);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onReposition = () => place();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, place]);

  const yearMin = min ? getYear(parseISO(min)) : 1920;
  const yearMax = max ? getYear(parseISO(max)) : getYear(new Date()) + 5;
  const years = Array.from(
    { length: Math.max(0, yearMax - yearMin) + 1 },
    (_, i) => yearMax - i,
  );

  const monthStart = startOfMonth(cursor);
  const days = eachDayOfInterval({
    start: startOfWeek(monthStart, { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 }),
  });

  const display = value
    ? format(parseISO(value), 'dd.MM.yyyy', { locale: ru })
    : '—';

  const todayIso = toIsoDate(new Date());
  const todayAllowed = inRange(todayIso, min, max);

  const pick = (iso: string) => {
    if (!inRange(iso, min, max)) return;
    onChange(iso);
    setOpen(false);
  };

  const panel =
    open && coords && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={label ? `Календарь: ${label}` : 'Календарь'}
            className="fixed z-[80] w-[17.5rem] rounded-2xl border border-slate-700 bg-slate-900 p-3 shadow-2xl shadow-black/50"
            style={{ top: coords.top, left: coords.left }}
          >
            <div className="mb-2 flex items-center justify-between gap-1.5">
              <button
                type="button"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                aria-label="Предыдущий месяц"
                onClick={() => setCursor((c) => addMonths(c, -1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="flex min-w-0 flex-1 items-center gap-1">
                <select
                  aria-label="Месяц"
                  className="input h-8 min-w-0 flex-1 px-1.5 py-0 text-xs capitalize"
                  value={getMonth(cursor)}
                  onChange={(e) =>
                    setCursor((c) => setMonth(c, Number(e.target.value)))
                  }
                >
                  {MONTH_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Год"
                  className="input h-8 w-[4.75rem] shrink-0 px-1.5 py-0 text-xs tabular-nums"
                  value={getYear(cursor)}
                  onChange={(e) =>
                    setCursor((c) => setYear(c, Number(e.target.value)))
                  }
                >
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                aria-label="Следующий месяц"
                onClick={() => setCursor((c) => addMonths(c, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] uppercase tracking-wide text-slate-500">
              {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((d) => (
                <div key={d} className="py-1">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {days.map((day) => {
                const iso = toIsoDate(day);
                const inMonth = isSameMonth(day, cursor);
                const selectedDay = value ? isSameDay(day, selected) : false;
                const today = isToday(day);
                const allowed = inRange(iso, min, max);
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    disabled={!allowed}
                    onClick={() => pick(iso)}
                    className={[
                      'relative h-8 rounded-lg text-sm tabular-nums transition',
                      !allowed
                        ? 'cursor-not-allowed text-slate-700'
                        : inMonth
                          ? 'text-slate-100'
                          : 'text-slate-600',
                      selectedDay
                        ? 'bg-fitgo-500 font-semibold text-white shadow-md shadow-fitgo-500/30'
                        : allowed && today
                          ? 'ring-1 ring-fitgo-400/70 hover:bg-slate-800'
                          : allowed
                            ? 'hover:bg-slate-800'
                            : '',
                    ].join(' ')}
                  >
                    {format(day, 'd')}
                    {selectedDay ? (
                      <span className="absolute inset-x-1 bottom-0.5 mx-auto h-0.5 rounded-full bg-white/80" />
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-2 text-[11px] text-slate-500">
              <span>
                Выбрано:{' '}
                <span className="font-medium text-fitgo-300">{display}</span>
              </span>
              <button
                type="button"
                className={
                  todayAllowed
                    ? 'text-fitgo-400 hover:underline'
                    : 'cursor-not-allowed text-slate-600'
                }
                disabled={!todayAllowed}
                onClick={() => pick(todayIso)}
              >
                Сегодня
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className={`relative text-sm ${className ?? ''}`}>
      {label ? (
        <span className="mb-1 block h-4 text-slate-400">{label}</span>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
        className={`input flex items-center justify-between gap-2 text-left tabular-nums disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? 'ring-2 ring-fitgo-500' : ''
        } ${inputClassName ?? ''}`}
      >
        <span className={value ? 'text-slate-100' : 'text-slate-500'}>
          {display}
        </span>
        <CalendarDays className="h-4 w-4 shrink-0 text-fitgo-400" aria-hidden />
      </button>
      {required ? (
        <input
          tabIndex={-1}
          aria-hidden
          className="sr-only"
          required
          value={value}
          onChange={() => undefined}
        />
      ) : null}
      {panel}
    </div>
  );
}
