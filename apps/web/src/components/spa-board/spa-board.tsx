'use client';

import type {
  SpaBoardBooking,
  SpaBoardHourBlock,
  SpaBoardResponse,
  SpaBoardStaff,
} from '@fitgo/shared-types';
import { useEffect, useMemo, useState } from 'react';

const DAY_START_HOUR = 8;
const DAY_END_HOUR = 22;
const PX_PER_MIN = 1.05;

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

function staffShort(s: SpaBoardStaff) {
  const initial = s.firstName?.trim()?.[0];
  return initial
    ? `${s.lastName} ${initial}.`
    : s.lastName || s.firstName || '—';
}

function staffFull(s: SpaBoardStaff) {
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

  const defaultStaffId =
    viewerSpecialistId &&
    board.staff.some((s) => s.id === viewerSpecialistId)
      ? viewerSpecialistId
      : (board.staff[0]?.id ?? '');

  const [selectedStaffId, setSelectedStaffId] = useState(defaultStaffId);

  useEffect(() => {
    if (mobileStaffId) {
      setSelectedStaffId(mobileStaffId);
      return;
    }
    if (
      selectedStaffId &&
      board.staff.some((s) => s.id === selectedStaffId)
    ) {
      return;
    }
    setSelectedStaffId(defaultStaffId);
  }, [board.staff, defaultStaffId, mobileStaffId, selectedStaffId]);

  const setStaff = (id: string) => {
    setSelectedStaffId(id);
    onMobileStaffChange?.(id);
  };

  const activeStaff =
    board.staff.find((s) => s.id === selectedStaffId) ?? board.staff[0];

  const renderColumn = (staff: SpaBoardStaff) => {
    const own = mode === 'admin' || staff.id === viewerSpecialistId;
    const bands = hourBandsForStaff(board.hours, staff.id, dayStart);
    const items = bookingsForStaff(board.bookings, staff.id, dayStart);

    return (
      <div
        className="relative w-full border-l border-slate-800"
        style={{ height }}
        onClick={(e) => {
          if (!own || !onEmptySlotClick) return;
          const rect = (
            e.currentTarget as HTMLDivElement
          ).getBoundingClientRect();
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

        {own && bands.length === 0 ? (
          <p className="pointer-events-none absolute inset-x-2 top-3 text-center text-[11px] text-slate-500">
            Нет рабочих часов · настройте шаблон ниже
          </p>
        ) : null}

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
                  <p className="truncate text-amber-200/80">{b.serviceName}</p>
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

  const timeRail = (
    <div className="sticky left-0 z-10 w-11 shrink-0 bg-slate-950/95 sm:w-12">
      <div className="h-9 border-b border-slate-800" />
      <div className="relative" style={{ height }}>
        {hours.map((h) => (
          <div
            key={h}
            className="absolute left-0 right-0 border-t border-slate-800/80 px-0.5 text-[10px] tabular-nums text-slate-500"
            style={{ top: (h - DAY_START_HOUR) * 60 * PX_PER_MIN }}
          >
            {String(h).padStart(2, '0')}:00
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => onDayChange(addDays(dayStart, -1))}
        >
          ←
        </button>
        <p className="min-w-[8.5rem] text-center text-sm font-medium capitalize">
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

      {/* Staff filter — phone / tablet */}
      <div className="space-y-1.5 lg:hidden">
        <p className="text-xs text-slate-500">Сотрудник</p>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {board.staff.map((s) => {
            const on = s.id === activeStaff?.id;
            return (
              <button
                key={s.id}
                type="button"
                className={`shrink-0 rounded-xl px-3 py-1.5 text-xs ${
                  on
                    ? 'bg-fitgo-500 text-white'
                    : 'bg-slate-800 text-slate-300'
                }`}
                onClick={() => setStaff(s.id)}
              >
                {staffShort(s)}
                {s.id === viewerSpecialistId ? ' · я' : ''}
              </button>
            );
          })}
        </div>
      </div>

      {/* Phone / tablet: one column */}
      <div className="card overflow-hidden p-0 lg:hidden">
        {activeStaff ? (
          <div className="flex min-w-0">
            {timeRail}
            <div className="min-w-0 flex-1">
              <div className="flex h-9 items-center truncate border-b border-slate-800 px-2 text-xs font-medium">
                {staffFull(activeStaff)}
                {activeStaff.id === viewerSpecialistId ? (
                  <span className="ml-1 text-fitgo-400">(я)</span>
                ) : (
                  <span className="ml-1 text-slate-500">· коллега</span>
                )}
              </div>
              {renderColumn(activeStaff)}
            </div>
          </div>
        ) : (
          <p className="p-4 text-sm text-slate-400">Нет специалистов</p>
        )}
      </div>

      {/* Desktop wide: all columns */}
      <div className="card hidden overflow-x-auto p-0 lg:block">
        <div className="flex min-w-max">
          {timeRail}
          {board.staff.map((s) => (
            <div key={s.id} className="flex w-[7.5rem] shrink-0 flex-col xl:w-36">
              <div
                className={`flex h-9 items-center justify-center border-b border-l border-slate-800 px-1 text-center text-[11px] font-medium leading-tight ${
                  s.id === viewerSpecialistId ? 'text-fitgo-300' : ''
                }`}
                title={staffFull(s)}
              >
                {staffShort(s)}
                {s.id === viewerSpecialistId ? ' ·я' : ''}
              </div>
              {renderColumn(s)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
