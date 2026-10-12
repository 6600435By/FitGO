'use client';

import { useEffect, useId, useRef, useState } from 'react';

type Props = {
  label?: string;
  value: string; // YYYY-MM-DD
  onChange: (next: string) => void;
  className?: string;
};

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatRu(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Same UX as apps/web DateField (Нестыковки → Свой), specialist tokens. */
export function DateField({ label, value, onChange, className }: Props) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = value ? parseIso(value) : new Date();
  const [cursor, setCursor] = useState(
    () => new Date(selected.getFullYear(), selected.getMonth(), 1),
  );

  useEffect(() => {
    if (open) {
      setCursor(new Date(selected.getFullYear(), selected.getMonth(), 1));
    }
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Date[] = [];
  for (let i = 0; i < startOffset; i++) {
    cells.push(new Date(year, month, -startOffset + i + 1));
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(year, month, d));
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1];
    cells.push(
      new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1),
    );
  }

  const display = formatRu(value);
  const today = new Date();

  return (
    <div ref={rootRef} className={`relative text-sm ${className ?? ''}`}>
      {label ? (
        <span className="mb-1 block" style={{ color: 'var(--muted)' }}>
          {label}
        </span>
      ) : null}
      <button
        type="button"
        id={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="field flex items-center justify-between gap-2 text-left tabular-nums"
        style={
          open
            ? { outline: '2px solid var(--accent)', outlineOffset: 0 }
            : undefined
        }
      >
        <span>{display}</span>
        <svg
          aria-hidden
          className="h-4 w-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={label ? `Календарь: ${label}` : 'Календарь'}
          className="absolute left-0 top-[calc(100%+0.35rem)] z-50 w-[17.5rem] p-3"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow)',
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              className="rounded-lg px-2 py-1"
              style={{ color: 'var(--muted)' }}
              aria-label="Предыдущий месяц"
              onClick={() => setCursor(new Date(year, month - 1, 1))}
            >
              ‹
            </button>
            <div className="text-sm font-medium capitalize">
              {MONTHS[month]} {year}
            </div>
            <button
              type="button"
              className="rounded-lg px-2 py-1"
              style={{ color: 'var(--muted)' }}
              aria-label="Следующий месяц"
              onClick={() => setCursor(new Date(year, month + 1, 1))}
            >
              ›
            </button>
          </div>

          <div
            className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] uppercase tracking-wide"
            style={{ color: 'var(--muted)' }}
          >
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day) => {
              const inMonth = day.getMonth() === month;
              const selectedDay = value ? sameDay(day, selected) : false;
              const isToday = sameDay(day, today);
              return (
                <button
                  key={toIso(day)}
                  type="button"
                  onClick={() => {
                    onChange(toIso(day));
                    setOpen(false);
                  }}
                  className="relative h-8 rounded-lg text-sm tabular-nums transition"
                  style={{
                    color: inMonth ? 'var(--fg)' : 'var(--muted)',
                    opacity: inMonth ? 1 : 0.45,
                    background: selectedDay ? 'var(--accent)' : 'transparent',
                    fontWeight: selectedDay ? 600 : 400,
                    boxShadow: isToday && !selectedDay
                      ? 'inset 0 0 0 1px var(--accent)'
                      : undefined,
                  }}
                >
                  <span
                    style={
                      selectedDay ? { color: 'var(--accent-fg)' } : undefined
                    }
                  >
                    {day.getDate()}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            className="mt-2 flex items-center justify-between border-t pt-2 text-[11px]"
            style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}
          >
            <span>
              Выбрано:{' '}
              <span className="font-medium" style={{ color: 'var(--accent)' }}>
                {display}
              </span>
            </span>
            <button
              type="button"
              style={{ color: 'var(--accent)' }}
              onClick={() => {
                onChange(toIso(new Date()));
                setOpen(false);
              }}
            >
              Сегодня
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
