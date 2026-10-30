'use client';

import { SpaBookingNoteHint } from '@/components/spa-board/spa-booking-note-hint';
import type {
  SpaBoardBooking,
  SpaBoardHourBlock,
  SpaBoardResponse,
  SpaBoardStaff,
} from '@fitgo/shared-types';
import {
  SPA_FREE_GAP_MIN,
  SPA_OVERLAP_ALLOW_MIN,
  checkSpaPlacement,
  computeSpaFreeWindows,
  packSpaBookingLanes,
} from '@fitgo/shared-types';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

const DAY_START_HOUR = 8;
const DAY_END_HOUR = 22;
const PX_PER_MIN = 1.05;
const GRID_STEP_MIN = 15;
const MOUSE_DRAG_THRESHOLD_PX = 6;
const TOUCH_SCROLL_SLOP_PX = 8;
const TOUCH_DRAG_DELAY_MS = 480;
const NOW_MARKER_TICK_MS = 30_000;

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

function sameCalendarDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
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

function earliestShiftStartMin(
  hours: SpaBoardHourBlock[],
  specialistId: string,
  day: Date,
) {
  const bands = hourBandsForStaff(hours, specialistId, day);
  if (bands.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(...bands.map((h) => minutesFromDayStart(h.startAt, day)));
}

/**
 * Visible day window for one specialist: from first work/booking hour
 * through last, snapped to hour edges (no empty rows outside the shift).
 */
function staffDayViewport(
  hours: SpaBoardHourBlock[],
  bookings: SpaBoardBooking[],
  specialistId: string,
  day: Date,
  dayTotalMin: number,
): { viewStartMin: number; viewEndMin: number } | null {
  const bands = hourBandsForStaff(hours, specialistId, day);
  const items = bookingsForStaff(bookings, specialistId, day);
  if (bands.length === 0 && items.length === 0) return null;

  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const h of bands) {
    start = Math.min(start, minutesFromDayStart(h.startAt, day));
    end = Math.max(end, minutesFromDayStart(h.endAt, day));
  }
  for (const b of items) {
    start = Math.min(start, minutesFromDayStart(b.startAt, day));
    end = Math.max(end, minutesFromDayStart(b.endAt, day));
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

  const viewStartMin = Math.max(0, Math.floor(start / 60) * 60);
  const viewEndMin = Math.min(dayTotalMin, Math.ceil(end / 60) * 60);
  if (viewEndMin <= viewStartMin) return null;
  return { viewStartMin, viewEndMin };
}

/** Hour start, or end of a booking that finishes inside that hour. */
function resolveEmptySlotStartAt(
  clickMinsFromDayStart: number,
  items: SpaBoardBooking[],
  day: Date,
) {
  const hourStart =
    Math.floor(Math.max(0, clickMinsFromDayStart) / 60) * 60;
  const hourEnd = hourStart + 60;

  let prevEndInHour: number | null = null;
  for (const b of items) {
    const end = minutesFromDayStart(b.endAt, day);
    if (end > hourStart && end <= hourEnd) {
      if (prevEndInHour == null || end > prevEndInHour) {
        prevEndInHour = end;
      }
    }
  }

  const startMins = prevEndInHour ?? hourStart;
  return new Date(
    day.getTime() + (DAY_START_HOUR * 60 + startMins) * 60000,
  );
}

function minutesToTimeLabel(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isTouchPointer(pointerType: string) {
  return pointerType === 'touch' || pointerType === 'pen';
}

type DragValidity = 'ok' | 'overlap' | 'invalid';

type DragState = {
  booking: SpaBoardBooking;
  specialistId: string;
  startMinutes: number;
  durationMin: number;
  height: number;
  valid: boolean;
  validity: DragValidity;
  overlapMin: number;
};

type PendingOverlapConfirm = {
  booking: SpaBoardBooking;
  specialistId: string;
  startAt: Date;
  overlapMin: number;
  peerLabel: string;
};

type PointerStart = {
  booking: SpaBoardBooking;
  x: number;
  y: number;
  height: number;
  durationMin: number;
  pointerType: string;
};

export type SpaBoardMode = 'specialist' | 'admin';

export function SpaBoard({
  board,
  mode,
  viewerSpecialistId,
  day,
  onDayChange,
  onEmptySlotClick,
  onBookingDoubleClick,
  onBookingMove,
  onEditDayHours,
  mobileStaffId,
  onMobileStaffChange,
  focusSpecialistId,
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
  onBookingDoubleClick?: (booking: SpaBoardBooking) => void;
  onBookingMove?: (args: {
    booking: SpaBoardBooking;
    specialistId: string;
    startAt: Date;
    overlapConfirmed?: boolean;
  }) => void | Promise<void>;
  /** Edit published hours for the selected calendar day (own or picked staff). */
  onEditDayHours?: (args: { specialistId: string }) => void;
  mobileStaffId?: string;
  onMobileStaffChange?: (id: string) => void;
  /** Scroll / select this specialist column (deep-link from «В журнал»). */
  focusSpecialistId?: string;
}) {
  const dayStart = startOfDay(day);
  const totalMin = (DAY_END_HOUR - DAY_START_HOUR) * 60;
  const isToday = sameCalendarDay(dayStart, new Date());
  const dayBaseMs = dayStart.getTime() + DAY_START_HOUR * 60 * 60 * 1000;

  const [nowMinutes, setNowMinutes] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });
  const [overlapConfirm, setOverlapConfirm] =
    useState<PendingOverlapConfirm | null>(null);
  const [overlapConfirmBusy, setOverlapConfirmBusy] = useState(false);

  useEffect(() => {
    if (!isToday) return;
    const tick = () => {
      const n = new Date();
      setNowMinutes(n.getHours() * 60 + n.getMinutes());
    };
    tick();
    const timer = window.setInterval(tick, NOW_MARKER_TICK_MS);
    return () => window.clearInterval(timer);
  }, [isToday, dayStart]);

  const staffWorkingToday = useMemo(() => {
    const withHours = board.staff.filter(
      (s) => hourBandsForStaff(board.hours, s.id, dayStart).length > 0,
    );
    if (mode === 'specialist' && viewerSpecialistId) {
      const own = board.staff.find((s) => s.id === viewerSpecialistId);
      if (own && !withHours.some((s) => s.id === own.id)) {
        return [own, ...withHours];
      }
    }
    return withHours.length > 0 ? withHours : board.staff;
  }, [board.hours, board.staff, dayStart, mode, viewerSpecialistId]);

  const staffOrdered = useMemo(() => {
    const byShift = [...staffWorkingToday].sort((a, b) => {
      const da = earliestShiftStartMin(board.hours, a.id, dayStart);
      const db = earliestShiftStartMin(board.hours, b.id, dayStart);
      if (da !== db) return da - db;
      return staffFull(a).localeCompare(staffFull(b), 'ru');
    });
    if (!viewerSpecialistId) return byShift;
    const own = byShift.filter((s) => s.id === viewerSpecialistId);
    const rest = byShift.filter((s) => s.id !== viewerSpecialistId);
    return [...own, ...rest];
  }, [board.hours, dayStart, staffWorkingToday, viewerSpecialistId]);

  const defaultStaffId =
    viewerSpecialistId &&
    staffOrdered.some((s) => s.id === viewerSpecialistId)
      ? viewerSpecialistId
      : (staffOrdered[0]?.id ?? '');

  const [selectedStaffId, setSelectedStaffId] = useState(defaultStaffId);

  useEffect(() => {
    if (mobileStaffId && staffOrdered.some((s) => s.id === mobileStaffId)) {
      setSelectedStaffId(mobileStaffId);
      return;
    }
    if (
      selectedStaffId &&
      staffOrdered.some((s) => s.id === selectedStaffId)
    ) {
      return;
    }
    setSelectedStaffId(defaultStaffId);
  }, [defaultStaffId, mobileStaffId, selectedStaffId, staffOrdered]);

  const setStaff = (id: string) => {
    setSelectedStaffId(id);
    onMobileStaffChange?.(id);
  };

  const activeStaff =
    staffOrdered.find((s) => s.id === selectedStaffId) ?? staffOrdered[0];

  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const viewStartByStaffRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const focus = focusSpecialistId?.trim();
    if (!focus || !staffOrdered.some((s) => s.id === focus)) return;
    setSelectedStaffId(focus);
    // Column refs fill after paint — retry once on next frame.
    const scroll = () => {
      columnRefs.current.get(focus)?.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      });
    };
    scroll();
    const t = window.setTimeout(scroll, 50);
    return () => window.clearTimeout(t);
  }, [focusSpecialistId, staffOrdered, dayStart]);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [pointerStart, setPointerStart] = useState<PointerStart | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pointerStartRef = useRef<PointerStart | null>(null);
  const touchArmTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const isMutatingRef = useRef(false);
  dragRef.current = drag;
  pointerStartRef.current = pointerStart;

  const isTracking = drag !== null || pointerStart !== null;

  const clearTouchArmTimer = useCallback(() => {
    if (touchArmTimerRef.current != null) {
      window.clearTimeout(touchArmTimerRef.current);
      touchArmTimerRef.current = null;
    }
  }, []);

  const canEditBooking = useCallback(
    (b: SpaBoardBooking) => {
      if (b.busy) return false;
      if (mode === 'admin') return true;
      return Boolean(viewerSpecialistId && b.specialistId === viewerSpecialistId);
    },
    [mode, viewerSpecialistId],
  );

  const evaluateDrop = useCallback(
    (
      specialistId: string,
      startMinutes: number,
      durationMin: number,
      excludeId?: string,
    ): { ok: boolean; validity: DragValidity; overlapMin: number; peerLabel: string } => {
      if (!staffOrdered.some((s) => s.id === specialistId)) {
        return { ok: false, validity: 'invalid', overlapMin: 0, peerLabel: '' };
      }
      if (mode === 'specialist' && viewerSpecialistId) {
        if (specialistId !== viewerSpecialistId) {
          return { ok: false, validity: 'invalid', overlapMin: 0, peerLabel: '' };
        }
      }
      if (startMinutes < 0 || startMinutes + durationMin > totalMin) {
        return { ok: false, validity: 'invalid', overlapMin: 0, peerLabel: '' };
      }

      const startMs = dayBaseMs + startMinutes * 60_000;
      const endMs = startMs + durationMin * 60_000;
      const bands = hourBandsForStaff(board.hours, specialistId, dayStart)
        .filter((h) => h.status === 'PUBLISHED')
        .map((h) => ({
          startMs: new Date(h.startAt).getTime(),
          endMs: new Date(h.endAt).getTime(),
        }));
      const inHours = bands.some((b) => startMs >= b.startMs && endMs <= b.endMs);
      if (!inHours) {
        return { ok: false, validity: 'invalid', overlapMin: 0, peerLabel: '' };
      }

      const peers = bookingsForStaff(board.bookings, specialistId, dayStart)
        .filter((b) => !b.busy && b.id !== excludeId)
        .map((b) => ({
          id: b.id,
          label: b.clientName ?? b.guestName ?? 'Клиент',
          startMs: new Date(b.startAt).getTime(),
          endMs: new Date(b.endAt).getTime(),
        }));
      const check = checkSpaPlacement(startMs, endMs, peers, SPA_OVERLAP_ALLOW_MIN);
      if (check.fitsClean) {
        return { ok: true, validity: 'ok', overlapMin: 0, peerLabel: '' };
      }
      if (check.allowedWithConfirm) {
        return {
          ok: true,
          validity: 'overlap',
          overlapMin: check.maxOverlapMin,
          peerLabel: check.peers[0]?.label ?? '',
        };
      }
      return {
        ok: false,
        validity: 'invalid',
        overlapMin: check.maxOverlapMin,
        peerLabel: check.peers[0]?.label ?? '',
      };
    },
    [board.bookings, board.hours, dayBaseMs, dayStart, mode, staffOrdered, totalMin, viewerSpecialistId],
  );

  const beginDragFromPending = useCallback(
    (pending: PointerStart) => {
      clearTouchArmTimer();
      const startMin = Math.max(
        0,
        Math.round(minutesFromDayStart(pending.booking.startAt, dayStart)),
      );
      const snapped = Math.floor(startMin / GRID_STEP_MIN) * GRID_STEP_MIN;
      const drop = evaluateDrop(
        pending.booking.specialistId,
        snapped,
        pending.durationMin,
        pending.booking.id,
      );
      setDrag({
        booking: pending.booking,
        specialistId: pending.booking.specialistId,
        startMinutes: snapped,
        durationMin: pending.durationMin,
        height: pending.height,
        valid: drop.ok,
        validity: drop.validity,
        overlapMin: drop.overlapMin,
      });
      setPointerStart(null);
    },
    [clearTouchArmTimer, dayStart, evaluateDrop],
  );

  const resolveDropTarget = useCallback(
    (clientX: number, clientY: number) => {
      for (const s of staffOrdered) {
        const el = columnRefs.current.get(s.id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (
          clientX < rect.left ||
          clientX > rect.right ||
          clientY < rect.top ||
          clientY > rect.bottom
        ) {
          continue;
        }
        const viewStart = viewStartByStaffRef.current.get(s.id) ?? 0;
        const colHeight = Math.max(1, rect.height);
        const relY = Math.max(0, Math.min(clientY - rect.top, colHeight - 1));
        const minsFromView =
          Math.floor(relY / PX_PER_MIN / GRID_STEP_MIN) * GRID_STEP_MIN;
        return {
          specialistId: s.id,
          minutes: viewStart + minsFromView,
        };
      }
      return null;
    },
    [staffOrdered],
  );

  const commitMove = useCallback(
    async (current: DragState, overlapConfirmed = false) => {
      if (!onBookingMove || isMutatingRef.current || !current.valid) return;
      const originMin = Math.round(
        minutesFromDayStart(current.booking.startAt, dayStart),
      );
      const moved =
        current.specialistId !== current.booking.specialistId ||
        Math.abs(originMin - current.startMinutes) >= 1;
      if (!moved) return;

      const startAt = new Date(
        dayStart.getTime() +
          (DAY_START_HOUR * 60 + current.startMinutes) * 60000,
      );

      if (current.validity === 'overlap' && !overlapConfirmed) {
        const drop = evaluateDrop(
          current.specialistId,
          current.startMinutes,
          current.durationMin,
          current.booking.id,
        );
        setOverlapConfirm({
          booking: current.booking,
          specialistId: current.specialistId,
          startAt,
          overlapMin: drop.overlapMin,
          peerLabel: drop.peerLabel,
        });
        return;
      }

      isMutatingRef.current = true;
      try {
        await onBookingMove({
          booking: current.booking,
          specialistId: current.specialistId,
          startAt,
          overlapConfirmed: current.validity === 'overlap' || overlapConfirmed,
        });
      } finally {
        isMutatingRef.current = false;
      }
    },
    [dayStart, evaluateDrop, onBookingMove],
  );

  const beginDragFromPendingRef = useRef(beginDragFromPending);
  beginDragFromPendingRef.current = beginDragFromPending;
  const commitMoveRef = useRef(commitMove);
  commitMoveRef.current = commitMove;

  useEffect(() => {
    if (!isTracking) return;

    function onPointerMove(e: PointerEvent) {
      const pending = pointerStartRef.current;
      const current = dragRef.current;

      if (pending && !current) {
        const dx = e.clientX - pending.x;
        const dy = e.clientY - pending.y;
        const dist = Math.hypot(dx, dy);

        // Touch: never preventDefault while only pending — native scroll must win.
        if (isTouchPointer(pending.pointerType)) {
          if (dist > TOUCH_SCROLL_SLOP_PX) {
            clearTouchArmTimer();
            pointerStartRef.current = null;
            setPointerStart(null);
          }
          return;
        }

        if (dist < MOUSE_DRAG_THRESHOLD_PX) return;
        e.preventDefault();
        beginDragFromPendingRef.current(pending);
        return;
      }

      if (!dragRef.current) return;
      // Active drag: block page/board scroll under the finger.
      if (e.cancelable) e.preventDefault();
      const target = resolveDropTarget(e.clientX, e.clientY);
      if (!target) return;

      setDrag((prev) => {
        if (!prev) return prev;
        if (
          prev.specialistId === target.specialistId &&
          prev.startMinutes === target.minutes
        ) {
          return prev;
        }
        const drop = evaluateDrop(
          target.specialistId,
          target.minutes,
          prev.durationMin,
          prev.booking.id,
        );
        return {
          ...prev,
          specialistId: target.specialistId,
          startMinutes: target.minutes,
          valid: drop.ok,
          validity: drop.validity,
          overlapMin: drop.overlapMin,
        };
      });
    }

    function onPointerUp() {
      const current = dragRef.current;
      const pending = pointerStartRef.current;
      clearTouchArmTimer();
      window.getSelection()?.removeAllRanges();

      if (current) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 400);
        setDrag(null);
        setPointerStart(null);
        void commitMoveRef.current(current);
        return;
      }

      if (pending) {
        setPointerStart(null);
      }
    }

    function onPointerCancel() {
      clearTouchArmTimer();
      if (dragRef.current) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 400);
      }
      setDrag(null);
      setPointerStart(null);
    }

    function onTouchMoveBlockScroll(e: TouchEvent) {
      if (!dragRef.current) return;
      if (e.cancelable) e.preventDefault();
    }

    window.addEventListener('touchmove', onTouchMoveBlockScroll, {
      passive: false,
    });
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      window.removeEventListener('touchmove', onTouchMoveBlockScroll);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      clearTouchArmTimer();
    };
  }, [clearTouchArmTimer, evaluateDrop, isTracking, resolveDropTarget]);

  useEffect(() => {
    if (!isTracking) return;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    if (drag) document.body.style.cursor = 'grabbing';
    return () => {
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [drag, isTracking]);

  const startBookingPointer = (
    e: ReactPointerEvent,
    booking: SpaBoardBooking,
    blockHeight: number,
    durationMin: number,
  ) => {
    if (!canEditBooking(booking) || !onBookingMove) return;
    if (suppressClickRef.current) return;
    e.stopPropagation();
    // Mouse: block text selection. Touch: keep default so the board can scroll.
    if (!isTouchPointer(e.pointerType)) {
      e.preventDefault();
    }

    const pending: PointerStart = {
      booking,
      x: e.clientX,
      y: e.clientY,
      height: blockHeight,
      durationMin,
      pointerType: e.pointerType,
    };

    clearTouchArmTimer();
    pointerStartRef.current = pending;
    setPointerStart(pending);

    if (isTouchPointer(e.pointerType)) {
      touchArmTimerRef.current = window.setTimeout(() => {
        const still = pointerStartRef.current;
        if (still && still.booking.id === booking.id) {
          beginDragFromPending(still);
        }
      }, TOUCH_DRAG_DELAY_MS);
    }
  };

  const nowDayMin = nowMinutes - DAY_START_HOUR * 60;

  const renderNowLine = (topPx: number | null) =>
    topPx == null ? null : (
      <div
        className="pointer-events-none absolute inset-x-0 z-20"
        style={{ top: topPx }}
        aria-hidden
        title={`Сейчас ${minutesToTimeLabel(nowMinutes)}`}
      >
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-rose-500/80" />
        <span className="absolute -left-0.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-rose-500" />
      </div>
    );

  const renderDragPreview = (d: DragState, viewStartMin: number) => (
    <div
      className={`pointer-events-none absolute left-1 right-1 z-30 overflow-hidden rounded-lg px-1.5 py-1 text-[11px] leading-tight shadow-lg ring-2 ${
        d.validity === 'ok'
          ? 'bg-amber-900/90 text-amber-50 ring-amber-400/80'
          : d.validity === 'overlap'
            ? 'bg-amber-800/95 text-amber-50 ring-amber-300/90'
            : 'bg-rose-950/90 text-rose-100 ring-rose-500/80'
      }`}
      style={{
        top: (d.startMinutes - viewStartMin) * PX_PER_MIN,
        height: d.height,
      }}
    >
      <p className="truncate font-medium">{d.booking.clientName ?? 'Клиент'}</p>
      <p className="truncate opacity-80">
        {minutesToTimeLabel(DAY_START_HOUR * 60 + d.startMinutes)} –{' '}
        {minutesToTimeLabel(
          DAY_START_HOUR * 60 + d.startMinutes + d.durationMin,
        )}
      </p>
      {d.validity === 'overlap' ? (
        <p className="truncate font-medium text-amber-100">
          пересечение {d.overlapMin} мин
        </p>
      ) : null}
    </div>
  );

  const renderColumn = (
    staff: SpaBoardStaff,
    view: { viewStartMin: number; viewEndMin: number },
  ) => {
    const own = mode === 'admin' || staff.id === viewerSpecialistId;
    const bands = hourBandsForStaff(board.hours, staff.id, dayStart);
    const items = bookingsForStaff(board.bookings, staff.id, dayStart);
    const isDropColumn = drag?.specialistId === staff.id;
    const { viewStartMin, viewEndMin } = view;
    const viewSpan = viewEndMin - viewStartMin;
    const colHeight = viewSpan * PX_PER_MIN;
    const hourMarks = Array.from(
      { length: Math.floor(viewSpan / 60) + 1 },
      (_, i) => viewStartMin + i * 60,
    );
    const nowTopInView =
      isToday && nowDayMin >= viewStartMin && nowDayMin <= viewEndMin
        ? (nowDayMin - viewStartMin) * PX_PER_MIN
        : null;

    viewStartByStaffRef.current.set(staff.id, viewStartMin);

    return (
      <div
        ref={(el) => {
          if (el) columnRefs.current.set(staff.id, el);
          else {
            columnRefs.current.delete(staff.id);
            viewStartByStaffRef.current.delete(staff.id);
          }
        }}
        className={`relative w-full ${
          isDropColumn && drag?.valid ? 'bg-fitgo-500/5' : ''
        }`}
        style={{ height: colHeight }}
        onClick={(e) => {
          if (suppressClickRef.current || drag || pointerStart) return;
          if (!own || !onEmptySlotClick) return;
          const rect = (
            e.currentTarget as HTMLDivElement
          ).getBoundingClientRect();
          const y = e.clientY - rect.top;
          const minsFromView = Math.floor(y / PX_PER_MIN);
          const mins = viewStartMin + minsFromView;
          if (mins < viewStartMin || mins >= viewEndMin) return;
          const startAt = resolveEmptySlotStartAt(mins, items, dayStart);
          onEmptySlotClick({ specialistId: staff.id, startAt });
        }}
      >
        {hourMarks.map((m) => (
          <div
            key={m}
            className="pointer-events-none absolute inset-x-0 border-t border-slate-800/80"
            style={{ top: (m - viewStartMin) * PX_PER_MIN }}
          />
        ))}

        {bands.map((h) => {
          const top = minutesFromDayStart(h.startAt, dayStart);
          const end = minutesFromDayStart(h.endAt, dayStart);
          if (end <= viewStartMin || top >= viewEndMin) return null;
          const clippedTop = Math.max(viewStartMin, top);
          const clippedEnd = Math.min(viewEndMin, end);
          return (
            <div
              key={h.id}
              className={
                h.status === 'DRAFT'
                  ? 'pointer-events-none absolute inset-x-0 border border-dashed border-fitgo-500/40 bg-fitgo-500/5'
                  : 'pointer-events-none absolute inset-x-0 bg-fitgo-500/10'
              }
              style={{
                top: (clippedTop - viewStartMin) * PX_PER_MIN,
                height: Math.max(4, (clippedEnd - clippedTop) * PX_PER_MIN),
              }}
            />
          );
        })}

        {renderNowLine(nowTopInView)}

        {(() => {
          const publishedBands = bands
            .filter((h) => h.status === 'PUBLISHED')
            .map((h) => ({
              startMs: new Date(h.startAt).getTime(),
              endMs: new Date(h.endAt).getTime(),
            }));
          const bookingIntervals = items
            .filter((b) => !b.busy)
            .map((b) => ({
              startMs: new Date(b.startAt).getTime(),
              endMs: new Date(b.endAt).getTime(),
            }));
          const freeWindows = computeSpaFreeWindows(
            publishedBands,
            bookingIntervals,
            SPA_FREE_GAP_MIN,
          );
          return freeWindows.map((w) => {
            const top = (w.startMs - dayBaseMs) / 60_000;
            const end = (w.endMs - dayBaseMs) / 60_000;
            if (end <= viewStartMin || top >= viewEndMin) return null;
            const clippedTop = Math.max(viewStartMin, top);
            const clippedEnd = Math.min(viewEndMin, end);
            const height = Math.max(
              18,
              (clippedEnd - clippedTop) * PX_PER_MIN,
            );
            const startAt = new Date(w.startMs);
            return (
              <button
                key={`free-${w.startMs}-${w.endMs}`}
                type="button"
                className="spa-free-gap absolute inset-x-1 z-[1] overflow-hidden rounded-md border border-dashed border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-left text-[10px] leading-tight text-emerald-300/90 hover:bg-emerald-500/20"
                style={{
                  top: (clippedTop - viewStartMin) * PX_PER_MIN,
                  height,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!own || !onEmptySlotClick) return;
                  onEmptySlotClick({ specialistId: staff.id, startAt });
                }}
              >
                <span className="font-medium">
                  свободно {w.durationMin} мин
                </span>
                {height >= 32 ? (
                  <span className="mt-0.5 block tabular-nums opacity-90">
                    {minutesToTimeLabel(DAY_START_HOUR * 60 + top)}–
                    {minutesToTimeLabel(DAY_START_HOUR * 60 + end)}
                  </span>
                ) : null}
              </button>
            );
          });
        })()}

        {(() => {
          const lanes = packSpaBookingLanes(
            items.map((b) => ({
              id: b.id,
              startMs: new Date(b.startAt).getTime(),
              endMs: new Date(b.endAt).getTime(),
            })),
          );
          return items.map((b) => {
            const top = minutesFromDayStart(b.startAt, dayStart);
            const end = minutesFromDayStart(b.endAt, dayStart);
            if (end <= viewStartMin || top >= viewEndMin) return null;
            const clippedTop = Math.max(viewStartMin, top);
            const clippedEnd = Math.min(viewEndMin, end);
            const blockHeight = Math.max(
              22,
              (clippedEnd - clippedTop) * PX_PER_MIN,
            );
            const durationMin = Math.max(GRID_STEP_MIN, Math.round(end - top));
            const editable = canEditBooking(b);
            const isDragging = drag?.booking.id === b.id;
            const lane = lanes.get(b.id) ?? { lane: 0, laneCount: 1 };
            const peerOverlap = (() => {
              if (b.busy) return 0;
              const peers = items
                .filter((o) => o.id !== b.id && !o.busy)
                .map((o) => ({
                  id: o.id,
                  label: o.clientName ?? 'Клиент',
                  startMs: new Date(o.startAt).getTime(),
                  endMs: new Date(o.endAt).getTime(),
                }));
              return checkSpaPlacement(
                new Date(b.startAt).getTime(),
                new Date(b.endAt).getTime(),
                peers,
                SPA_OVERLAP_ALLOW_MIN,
              ).maxOverlapMin;
            })();
            return (
              <button
                key={b.id}
                type="button"
                disabled={b.busy}
                onPointerDown={(e) => {
                  if (!editable) return;
                  startBookingPointer(e, b, blockHeight, durationMin);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (suppressClickRef.current || dragRef.current) return;
                  if (!b.busy && onBookingDoubleClick) onBookingDoubleClick(b);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (suppressClickRef.current || dragRef.current) return;
                  if (!b.busy && onBookingDoubleClick) onBookingDoubleClick(b);
                }}
                className={`spa-booking-cell-day absolute z-[2] overflow-hidden rounded-lg px-1.5 py-1 text-left text-[11px] leading-tight touch-manipulation ${
                  b.busy
                    ? 'bg-slate-800 text-slate-400'
                    : editable
                      ? 'cursor-grab border-l-[3px] border-amber-500 bg-amber-950/40 text-amber-50 active:cursor-grabbing'
                      : 'border-l-[3px] border-amber-500 bg-amber-950/40 text-amber-50'
                } ${isDragging ? 'opacity-30 touch-none' : ''}`}
                style={{
                  top: (clippedTop - viewStartMin) * PX_PER_MIN,
                  height: blockHeight,
                  left: `calc(${lane.lane} * (100% - 0.5rem) / ${lane.laneCount} + 0.25rem)`,
                  width: `calc((100% - 0.5rem) / ${lane.laneCount} - 0.15rem)`,
                }}
              >
                {b.busy ? (
                  <span>Занято</span>
                ) : (
                  <>
                    <SpaBookingNoteHint
                      clientNote={b.clientNote}
                      visitNote={b.visitNote}
                    />
                    <p
                      className={`spa-booking-cell-title truncate font-medium ${
                        b.clientNote || b.visitNote ? 'pr-5' : ''
                      }`}
                    >
                      {b.clientName ?? 'Клиент'}
                    </p>
                    <p className="spa-booking-cell-meta truncate text-amber-100">
                      {b.serviceName}
                    </p>
                    {peerOverlap > 0 ? (
                      <p className="spa-booking-cell-meta truncate text-amber-100">
                        ∩ {peerOverlap} мин
                      </p>
                    ) : null}
                    {b.oneCLinkStatus === 'NOT_LINKED' &&
                    !b.manualPaymentConfirmed ? (
                      <p className="truncate text-rose-300">Нет в 1С</p>
                    ) : null}
                    {b.manualPaymentConfirmed ? (
                      <p className="truncate text-sky-300">Оплата без 1С</p>
                    ) : null}
                    {b.approvalLabel ? (
                      <p className="spa-booking-cell-meta truncate text-amber-100">
                        {b.approvalLabel}
                      </p>
                    ) : null}
                  </>
                )}
              </button>
            );
          });
        })()}

        {drag && isDropColumn
          ? renderDragPreview(drag, viewStartMin)
          : null}
      </div>
    );
  };

  const renderTimeRail = (view: {
    viewStartMin: number;
    viewEndMin: number;
  }) => {
    const { viewStartMin, viewEndMin } = view;
    const viewSpan = viewEndMin - viewStartMin;
    const colHeight = viewSpan * PX_PER_MIN;
    const hourMarks = Array.from(
      { length: Math.floor(viewSpan / 60) + 1 },
      (_, i) => viewStartMin + i * 60,
    );
    const nowTopInView =
      isToday && nowDayMin >= viewStartMin && nowDayMin <= viewEndMin
        ? (nowDayMin - viewStartMin) * PX_PER_MIN
        : null;

    return (
      <div className="admin-time-rail w-12 shrink-0 border-r border-slate-800 bg-slate-950">
        <div className="relative" style={{ height: colHeight }}>
          {hourMarks.map((m) => {
            const clockHour = DAY_START_HOUR + m / 60;
            const label = `${String(Math.floor(clockHour)).padStart(2, '0')}:00`;
            const isClosing = m >= viewEndMin;
            const topPx = isClosing
              ? (m - viewStartMin) * PX_PER_MIN
              : (m - viewStartMin) * PX_PER_MIN + (60 * PX_PER_MIN) / 2;
            return (
              <div
                key={m}
                className="absolute left-0 right-0 flex justify-end px-1 text-[10px] tabular-nums leading-none text-slate-500"
                style={{
                  top: topPx,
                  transform: 'translateY(-50%)',
                }}
              >
                {label}
              </div>
            );
          })}
          {nowTopInView != null ? (
            <div
              className="pointer-events-none absolute inset-x-0 z-20"
              style={{ top: nowTopInView }}
              aria-hidden
            >
              <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-rose-500/80" />
              <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[9px] font-medium text-rose-400">
                {minutesToTimeLabel(nowMinutes)}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className="btn-secondary !px-2.5 !py-1 text-xs"
          onClick={() => onDayChange(addDays(dayStart, -1))}
        >
          ←
        </button>
        <p className="min-w-[7.5rem] text-center text-sm font-medium capitalize">
          {formatDayLabel(dayStart)}
        </p>
        <button
          type="button"
          className="btn-secondary !px-2.5 !py-1 text-xs"
          onClick={() => onDayChange(addDays(dayStart, 1))}
        >
          →
        </button>
        <button
          type="button"
          className="btn-secondary !px-2.5 !py-1 text-xs"
          onClick={() => onDayChange(startOfDay(new Date()))}
        >
          Сегодня
        </button>
        {onEditDayHours ? (
          <button
            type="button"
            className="btn-secondary !px-2.5 !py-1 text-xs"
            onClick={() => {
              const id =
                mode === 'specialist' && viewerSpecialistId
                  ? viewerSpecialistId
                  : activeStaff?.id;
              if (!id) return;
              onEditDayHours({ specialistId: id });
            }}
          >
            Часы дня
          </button>
        ) : null}
      </div>

      {staffOrdered.length === 0 ? (
        <div className="card p-4 text-sm text-slate-400">
          Сегодня никто не работает
        </div>
      ) : (
        <div className="space-y-3">
          {staffOrdered.map((s) => {
            const view = staffDayViewport(
              board.hours,
              board.bookings,
              s.id,
              dayStart,
              totalMin,
            );
            const shiftMin = earliestShiftStartMin(board.hours, s.id, dayStart);
            const shiftLabel =
              Number.isFinite(shiftMin) && shiftMin < totalMin
                ? minutesToTimeLabel(DAY_START_HOUR * 60 + Math.max(0, shiftMin))
                : null;
            const selected = s.id === activeStaff?.id;
            const own = mode === 'admin' || s.id === viewerSpecialistId;
            return (
              <div key={s.id} className="card overflow-hidden p-0">
                <button
                  type="button"
                  className={`flex w-full items-center justify-between gap-2 border-b border-slate-800 px-3 py-2 text-left ${
                    selected ? 'bg-fitgo-500/10' : 'bg-slate-900/60'
                  }`}
                  onClick={() => setStaff(s.id)}
                >
                  <span
                    className={`text-sm font-medium ${
                      s.id === viewerSpecialistId ? 'text-fitgo-300' : ''
                    }`}
                  >
                    {staffFull(s)}
                    {s.id === viewerSpecialistId ? ' · я' : ''}
                  </span>
                  {shiftLabel ? (
                    <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
                      смена с {shiftLabel}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[11px] text-slate-600">
                      нет смены
                    </span>
                  )}
                </button>
                {view ? (
                  <div className="flex min-w-0">
                    {renderTimeRail(view)}
                    <div className="min-w-0 flex-1">
                      {renderColumn(s, view)}
                    </div>
                  </div>
                ) : (
                  <p className="px-3 py-4 text-center text-[11px] text-slate-500">
                    {own
                      ? 'Нет рабочих часов · настройте шаблон ниже'
                      : 'Сегодня не работает'}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {overlapConfirm ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal
          aria-labelledby="spa-overlap-confirm-title"
        >
          <div className="card max-w-sm space-y-3 p-4 shadow-xl">
            <h3
              id="spa-overlap-confirm-title"
              className="text-sm font-semibold"
            >
              Наслоение записей
            </h3>
            <p className="text-sm text-slate-300">
              Пересечение {overlapConfirm.overlapMin} мин
              {overlapConfirm.peerLabel
                ? ` с «${overlapConfirm.peerLabel}»`
                : ''}
              . Подтвердите, чтобы сохранить.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={overlapConfirmBusy}
                onClick={() => setOverlapConfirm(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={overlapConfirmBusy || !onBookingMove}
                onClick={() => {
                  if (!onBookingMove) return;
                  const pending = overlapConfirm;
                  setOverlapConfirmBusy(true);
                  void (async () => {
                    try {
                      await onBookingMove({
                        booking: pending.booking,
                        specialistId: pending.specialistId,
                        startAt: pending.startAt,
                        overlapConfirmed: true,
                      });
                      setOverlapConfirm(null);
                    } finally {
                      setOverlapConfirmBusy(false);
                    }
                  })();
                }}
              >
                Подтверждаю наслоение
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
