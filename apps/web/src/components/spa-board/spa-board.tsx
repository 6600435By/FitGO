'use client';

import type {
  SpaBoardBooking,
  SpaBoardHourBlock,
  SpaBoardResponse,
  SpaBoardStaff,
} from '@fitgo/shared-types';
import { useMemo, useState } from 'react';

const DAY_START_HOUR = 8;
const DAY_END_HOUR = 22;
const PX_PER_MIN = 1.1;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function formatDayLabel(d: Date) {
  return d.toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function minutesFromDayStart(iso: string, day: Date) {
  const t = new Date(iso).getTime();
  const base = day.getTime() + DAY_START_HOUR * 60 * 60 * 1000;
  return (t - base) / 60000;
}

function overlapsDay(startIso: string, endIso: string, day: Date) {
  const dayStart = day.getTime();
  const dayEnd = addDays(day, 1).getTime();
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  return s < dayEnd && e > dayStart;
}

function staffLabel(s: SpaBoardStaff) {
  return `${s.lastName} ${s.firstName}`.trim();
}

function hourBandsForStaff(
  hours: SpaBoardHourBlock[],
  specialistId: string,
  day: Date,
) {
  return hours.filter(
    (h) =>
      h.specialistId === specialistId &&
      overlapsDay(h.startAt, h.endAt, day),
  );
}

function bookingsForStaff(
  bookings: SpaBoardBooking[],
  specialistId: string,
  day: Date,
) {
  return bookings.filter(
    (b) =>
      b.specialistId === specialistId &&
      overlapsDay(b.startAt, b.endAt, day),
  );
}

export type SpaBoardMode = 'specialist' | 'admin';

export function SpaBoard({
  board,
  mode,
  viewerSpecialistId,
  day,
  onDayChange,
  onEmptySlotClick,
  onBookingClick,
  mobileStaffId,
  onMobileStaffChange,
}: {
  board: SpaBoardResponse;
  mode: SpaBoardMode;
  viewerSpecialistId?: string;
  day: Date;
  onDayChange: (d: Date) => void;
  onEmptySlotClick?: (args: {
    specialistId: string;
    startAt: Date;
  }) => void;
  onBookingClick?: (booking: SpaBoardBooking) => void;
  mobileStaffId?: string;
  onMobileStaffChange?: (id: string) => void;
}) {
  const dayStart = startOfDay(day);
  const totalMin = (DAY_END_HOUR - DAY_START_HOUR) * 60;
  const height = totalMin * PX_PER_MIN;
  const hours = useMemo(
    () =>
      Array.from(
        { length: DAY_END_HOUR - DAY_START_HOUR + 1 },
        (_, i) => DAY_START_HOUR + i,
      ),
    [],
  );

  const [localMobileStaff, setLocalMobileStaff] = useState(
    () =>
      viewerSpecialistId ??
      board.staff[0]?.id ??
      '',
  );
  const activeMobile =
    mobileStaffId ?? localMobileStaff ?? board.staff[0]?.id ?? '';

  const setMobile = (id: string) => {
    onMobileStaffChange?.(id);
    setLocalMobileStaff(id);
  };

  const renderColumn = (staff: SpaBoardStaff, compact?: boolean) => {
    const own =
      mode === 'admin' || staff.id === viewerSpecialistId;
    const bands = hourBandsForStaff(board.hours, staff.id, dayStart);
    const items = bookingsForStaff(board.bookings, staff.id, dayStart);

    return (
      <div
        key={staff.id}
        className={`relative min-w-[140px] flex-1 border-l border-slate-800 ${
          compact ? 'min-w-0' : ''
        }`}
        style={{ height }}
        onClick={(e) => {
          if (!own || !onEmptySlotClick) return;
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          const y = e.clientY - rect.top;
          const mins = Math.floor(y / PX_PER_MIN / 15) * 15;
          if (mins < 0 || mins >= totalMin) return;
          const startAt = new Date(
            dayStart.getTime() + (DAY_START_HOUR * 60 + mins) * 60000,
          );
          onEmptySlotClick({ specialistId: staff.id, startAt });
        }}
      >
        {bands.map((h) => {
          const top = Math.max(0, minutesFromDayStart(h.startAt, dayStart));
          const end = Math.min(
            totalMin,
            minutesFromDayStart(h.endAt, dayStart),
          );
          if (end <= 0 || top >= totalMin) return null;
          return (
            <div
              key={h.id}
              className={
                h.status === 'DRAFT'
                  ? 'pointer-events-none absolute inset-x-0 border border-dashed border-fitgo-500/40 bg-fitgo-500/5'
                  : 'pointer-events-none absolute inset-x-0 bg-fitgo-500/10'
              }
              style={{
                top: top * PX_PER_MIN,
                height: Math.max(4, (end - top) * PX_PER_MIN),
              }}
            />
          );
        })}

        {items.map((b) => {
          const top = Math.max(0, minutesFromDayStart(b.startAt, dayStart));
          const end = Math.min(
            totalMin,
            minutesFromDayStart(b.endAt, dayStart),
          );
          if (end <= 0 || top >= totalMin) return null;
          const clickable = !b.busy && Boolean(onBookingClick);
          return (
            <button
              key={b.id}
              type="button"
              disabled={!clickable}
              onClick={(e) => {
                e.stopPropagation();
                if (clickable) onBookingClick?.(b);
              }}
              className={`absolute inset-x-1 overflow-hidden rounded-lg px-1.5 py-1 text-left text-[11px] leading-tight ${
                b.busy
                  ? 'bg-slate-800 text-slate-400'
                  : 'border-l-2 border-amber-500 bg-amber-950/40 text-amber-100'
              }`}
              style={{
                top: top * PX_PER_MIN,
                height: Math.max(22, (end - top) * PX_PER_MIN),
              }}
            >
              {b.busy ? (
                <span>Занято</span>
              ) : (
                <>
                  <p className="truncate font-medium">
                    {b.clientName ?? 'Клиент'}
                  </p>
                  <p className="truncate text-amber-200/80">
                    {b.serviceName}
                  </p>
                  {b.approvalLabel ? (
                    <p className="truncate text-amber-300/90">
                      {b.approvalLabel}
                    </p>
                  ) : null}
                </>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  const weekStaff =
    mode === 'specialist' && viewerSpecialistId
      ? board.staff.find((s) => s.id === viewerSpecialistId)
      : board.staff.find((s) => s.id === activeMobile) ?? board.staff[0];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => onDayChange(addDays(dayStart, -1))}
          >
            ←
          </button>
          <p className="min-w-[9rem] text-center text-sm font-medium">
            {formatDayLabel(dayStart)}
          </p>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => onDayChange(addDays(dayStart, 1))}
          >
            →
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => onDayChange(startOfDay(new Date()))}
          >
            Сегодня
          </button>
        </div>
        <div className="md:hidden">
          <select
            className="input text-sm"
            value={activeMobile}
            onChange={(e) => setMobile(e.target.value)}
          >
            {board.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {staffLabel(s)}
                {s.id === viewerSpecialistId ? ' (я)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Desktop: columns by staff */}
      <div className="card hidden overflow-x-auto md:block">
        <div className="flex min-w-max">
          <div className="sticky left-0 z-10 w-12 shrink-0 bg-slate-950/90">
            <div className="h-10 border-b border-slate-800" />
            <div className="relative" style={{ height }}>
              {hours.map((h) => (
                <div
                  key={h}
                  className="absolute left-0 right-0 border-t border-slate-800/80 px-1 text-[10px] text-slate-500"
                  style={{
                    top: (h - DAY_START_HOUR) * 60 * PX_PER_MIN,
                  }}
                >
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>
          </div>
          {board.staff.map((s) => (
            <div key={s.id} className="flex min-w-[150px] flex-1 flex-col">
              <div className="flex h-10 items-center justify-center border-b border-l border-slate-800 px-2 text-xs font-medium">
                {staffLabel(s)}
                {s.id === viewerSpecialistId ? (
                  <span className="ml-1 text-fitgo-400">(я)</span>
                ) : null}
              </div>
              {renderColumn(s)}
            </div>
          ))}
        </div>
      </div>

      {/* Mobile: one staff column */}
      <div className="card md:hidden">
        {weekStaff ? (
          <div className="flex">
            <div className="w-12 shrink-0">
              <div className="h-8" />
              <div className="relative" style={{ height }}>
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-slate-800/80 px-1 text-[10px] text-slate-500"
                    style={{
                      top: (h - DAY_START_HOUR) * 60 * PX_PER_MIN,
                    }}
                  >
                    {String(h).padStart(2, '0')}
                  </div>
                ))}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex h-8 items-center px-2 text-xs font-medium">
                {staffLabel(weekStaff)}
              </div>
              {renderColumn(weekStaff, true)}
            </div>
          </div>
        ) : (
          <p className="p-4 text-sm text-slate-400">Нет специалистов</p>
        )}
      </div>
    </div>
  );
}
