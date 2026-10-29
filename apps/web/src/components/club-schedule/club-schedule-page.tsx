'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  format,
  addDays,
  parseISO,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameDay,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ClubScheduleEvent } from '@fitgo/shared-types';
import { BookingControlPanel } from '@/components/booking-control/booking-control-panel';
import { DateField } from '@/components/ui/date-field';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import { createBookingControlApi } from '@/lib/booking-control-api';
import { createTrainerBookingControlApi } from '@/lib/trainer-booking-control-api';
import { trainerCabinetMode } from '@/lib/trainer-cabinet';
import { cn } from '@/lib/utils';

const TYPE_LABEL: Record<string, string> = {
  GROUP: 'ГП',
  PT: 'ПТ',
  SPA: 'SPA',
  DUTY: 'Дежурство',
};

const TYPE_CLASS: Record<string, string> = {
  GROUP: 'border-l-fitgo-500',
  PT: 'border-l-violet-500',
  SPA: 'border-l-amber-500',
  DUTY: 'border-l-slate-500',
};

const TYPE_PRESETS = new Set(['GROUP,PT,SPA', 'GROUP', 'PT', 'SPA']);

type ScheduleViewMode = 'day' | 'week';

function isPendingPhase(phase: string | undefined): boolean {
  return (
    phase === 'PENDING_ADMIN' ||
    phase === 'PENDING_TRAINER' ||
    phase === 'PENDING_PERFORMER'
  );
}

function normalizeTypes(raw: string | null): string {
  if (!raw) return 'GROUP,PT,SPA';
  const upper = raw
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)
    .join(',');
  return TYPE_PRESETS.has(upper) ? upper : 'GROUP,PT,SPA';
}

function weekBounds(day: string): { from: string; to: string; days: Date[] } {
  const anchor = parseISO(`${day}T12:00:00`);
  const fromD = startOfWeek(anchor, { weekStartsOn: 1 });
  const toD = endOfWeek(anchor, { weekStartsOn: 1 });
  return {
    from: format(fromD, 'yyyy-MM-dd'),
    to: format(toD, 'yyyy-MM-dd'),
    days: eachDayOfInterval({ start: fromD, end: toD }),
  };
}

function EventCard({
  ev,
  isTrainer,
  onOpen,
}: {
  ev: ClubScheduleEvent;
  isTrainer: boolean;
  onOpen: (ev: ClubScheduleEvent) => void;
}) {
  const clickable = Boolean(ev.sessionKey);
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => onOpen(ev)}
      className={cn(
        'card border-l-4 w-full text-left transition',
        TYPE_CLASS[ev.type] ?? 'border-l-slate-600',
        clickable
          ? 'hover:border-fitgo-500/50 hover:bg-slate-900/60 cursor-pointer'
          : 'cursor-default opacity-90',
      )}
    >
      <div className="flex justify-between gap-2">
        <div>
          <p className="text-xs text-slate-500">
            {TYPE_LABEL[ev.type] ?? ev.type}
            {!isTrainer && ev.staffName ? ` · ${ev.staffName}` : ''}
          </p>
          <p className="font-medium text-slate-100 mt-0.5">
            {format(parseISO(ev.startAt), 'HH:mm')}–
            {format(parseISO(ev.endAt), 'HH:mm')} · {ev.title}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {ev.clientName ? `${ev.clientName} · ` : ''}
            {ev.booked != null
              ? `записано ${ev.booked}${ev.capacity ? `/${ev.capacity}` : ''} · `
              : ''}
            {ev.approvalLabel || ev.status}
            {ev.payrollLocked ? ' · ЗП закрыт' : ''}
            {clickable ? ' · открыть →' : ''}
          </p>
        </div>
      </div>
    </button>
  );
}

export function ClubSchedulePage({
  apiBase,
}: {
  apiBase: 'admin' | 'super-admin' | 'trainer';
}) {
  const isTrainer = apiBase === 'trainer';
  const { isReformer, showPt } = trainerCabinetMode(getUser());
  const trainerAllowKindFilter = showPt || isReformer;
  const trainerDefaultTypes = trainerAllowKindFilter ? 'GROUP,PT' : 'GROUP';
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [day, setDay] = useState(() => {
    const d = searchParams.get('date');
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d)
      ? d
      : format(new Date(), 'yyyy-MM-dd');
  });
  const [view, setView] = useState<ScheduleViewMode>(() => {
    const v = searchParams.get('view');
    return v === 'week' ? 'week' : 'day';
  });
  const [types, setTypes] = useState(() => {
    if (!isTrainer) return normalizeTypes(searchParams.get('types'));
    const raw = searchParams.get('types');
    if (!trainerAllowKindFilter) return 'GROUP';
    if (raw === 'GROUP' || raw === 'PT' || raw === 'GROUP,PT') return raw;
    return trainerDefaultTypes;
  });
  const [events, setEvents] = useState<ClubScheduleEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [openSession, setOpenSession] = useState<{
    sessionKey: string;
    from: string;
    to: string;
  } | null>(null);
  const daySectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const panelApi = useMemo(
    () =>
      isTrainer
        ? createTrainerBookingControlApi()
        : createBookingControlApi(apiBase),
    [apiBase, isTrainer],
  );

  const maxDay = useMemo(
    () => format(addDays(new Date(), 31), 'yyyy-MM-dd'),
    [],
  );
  const minDay = useMemo(
    () => format(addDays(new Date(), -31), 'yyyy-MM-dd'),
    [],
  );

  const week = useMemo(() => weekBounds(day), [day]);
  const rangeFrom = view === 'week' ? week.from : day;
  const rangeTo = view === 'week' ? week.to : day;

  const writeUrl = useCallback(
    (nextDay: string, nextTypes: string, nextView: ScheduleViewMode) => {
      // Live bar — React searchParams lags the previous replace.
      const params = new URLSearchParams(window.location.search);
      params.set('date', nextDay);
      if (nextView === 'week') params.set('view', 'week');
      else params.delete('view');
      if (!isTrainer) {
        params.set('types', nextTypes);
      } else if (trainerAllowKindFilter && nextTypes !== trainerDefaultTypes) {
        params.set('types', nextTypes);
      } else {
        params.delete('types');
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [
      pathname,
      router,
      isTrainer,
      trainerAllowKindFilter,
      trainerDefaultTypes,
    ],
  );

  const updateDay = (next: string) => {
    setDay(next);
    writeUrl(next, types, view);
  };

  const updateView = (next: ScheduleViewMode) => {
    setView(next);
    writeUrl(day, types, next);
  };

  const updateTypes = (next: string) => {
    if (isTrainer && !trainerAllowKindFilter) return;
    setTypes(next);
    writeUrl(day, next, view);
  };

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const list = await api.adminClubSchedule(token, apiBase, {
        from: rangeFrom,
        to: rangeTo,
        types,
      });
      setEvents(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [apiBase, rangeFrom, rangeTo, types, isTrainer]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = events.filter((e) =>
    isPendingPhase(e.approvalPhase),
  ).length;

  const sorted = useMemo(() => {
    const base = [...events].sort(
      (a, b) =>
        new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    );
    if (!pendingOnly) return base;
    return base.filter((e) => isPendingPhase(e.approvalPhase));
  }, [events, pendingOnly]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, ClubScheduleEvent[]>();
    for (const d of week.days) {
      map.set(format(d, 'yyyy-MM-dd'), []);
    }
    for (const ev of sorted) {
      const key = format(parseISO(ev.startAt), 'yyyy-MM-dd');
      const list = map.get(key);
      if (list) list.push(ev);
      else if (view === 'day' && key === day) {
        // day view may not use week map
      }
    }
    return map;
  }, [sorted, week.days, view, day]);

  const openEvent = (ev: ClubScheduleEvent) => {
    if (!ev.sessionKey) return;
    const eventDay = format(parseISO(ev.startAt), 'yyyy-MM-dd');
    setOpenSession({
      sessionKey: ev.sessionKey,
      from: eventDay,
      to: eventDay,
    });
  };

  const shiftDay = (delta: number) => {
    const step = view === 'week' ? delta * 7 : delta;
    const next = format(addDays(parseISO(day), step), 'yyyy-MM-dd');
    if (next < minDay || next > maxDay) return;
    updateDay(next);
  };

  const scrollToDay = (key: string) => {
    const el = daySectionRefs.current[key];
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <h1 className="text-xl font-semibold text-slate-100">Расписание</h1>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex rounded-xl border border-slate-700 p-0.5">
            {(
              [
                ['day', 'День'],
                ['week', 'Неделя'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => updateView(value)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm transition',
                  view === value
                    ? 'bg-fitgo-500/20 text-fitgo-300'
                    : 'text-slate-400 hover:text-white',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => shiftDay(-1)}
            disabled={day <= minDay}
          >
            ‹
          </button>
          <DateField
            value={day}
            min={minDay}
            max={maxDay}
            onChange={updateDay}
            className="w-[10.5rem]"
            inputClassName="text-sm"
          />
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => updateDay(format(new Date(), 'yyyy-MM-dd'))}
          >
            Сегодня
          </button>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => shiftDay(1)}
            disabled={day >= maxDay}
          >
            ›
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {!isTrainer
          ? (
              [
                ['GROUP,PT,SPA', 'Все'],
                ['GROUP', 'ГП'],
                ['PT', 'ПТ'],
                ['SPA', 'SPA'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={
                  types === value
                    ? 'btn-primary text-xs'
                    : 'btn-secondary text-xs'
                }
                onClick={() => updateTypes(value)}
              >
                {label}
              </button>
            ))
          : trainerAllowKindFilter
            ? (
                [
                  ['GROUP,PT', 'Все'],
                  ['GROUP', 'ГП'],
                  ['PT', 'ПТ'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={
                    types === value
                      ? 'btn-primary text-xs'
                      : 'btn-secondary text-xs'
                  }
                  onClick={() => updateTypes(value)}
                >
                  {label}
                </button>
              ))
            : null}
        <button
          type="button"
          className={
            pendingOnly ? 'btn-primary text-xs' : 'btn-secondary text-xs'
          }
          onClick={() => setPendingOnly((v) => !v)}
        >
          Ждут подтверждения{pendingCount ? ` ${pendingCount}` : ''}
        </button>
      </div>

      {view === 'day' ? (
        <p className="text-sm text-slate-400">
          {format(parseISO(`${day}T12:00:00`), 'EEEE, d MMMM yyyy', {
            locale: ru,
          })}
          <span className="ml-2 text-slate-600">
            · можно листать до{' '}
            {format(parseISO(`${maxDay}T12:00:00`), 'd MMM', { locale: ru })}
          </span>
        </p>
      ) : (
        <p className="text-sm text-slate-400">
          {format(parseISO(`${week.from}T12:00:00`), 'd MMM', { locale: ru })}
          {' – '}
          {format(parseISO(`${week.to}T12:00:00`), 'd MMM yyyy', {
            locale: ru,
          })}
        </p>
      )}

      {view === 'week' ? (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {week.days.map((d) => {
            const key = format(d, 'yyyy-MM-dd');
            const count = eventsByDay.get(key)?.length ?? 0;
            const isToday = key === todayStr;
            const isAnchor = key === day;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setDay(key);
                  writeUrl(key, types, view);
                  scrollToDay(key);
                }}
                className={cn(
                  'flex min-w-[2.75rem] flex-1 flex-col items-center rounded-xl px-1 py-1.5 text-center transition',
                  isToday
                    ? 'bg-fitgo-500/20 text-fitgo-300 ring-1 ring-fitgo-500/40'
                    : isAnchor
                      ? 'bg-slate-800 text-slate-200'
                      : 'text-slate-400 hover:bg-slate-800/60',
                )}
              >
                <span className="text-[10px] uppercase">
                  {format(d, 'EEEEEE', { locale: ru })}
                </span>
                <span className="text-sm font-medium tabular-nums">
                  {format(d, 'd')}
                </span>
                <span className="text-[10px] text-slate-500">{count || '·'}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {error && (
        <p className="text-sm text-red-400 bg-red-950/40 rounded-xl px-3 py-2">
          {error}
        </p>
      )}
      {loading && <p className="text-sm text-slate-500">Загрузка…</p>}

      {view === 'day' ? (
        <>
          {!loading && !sorted.length && (
            <p className="card text-sm text-slate-500">Нет событий за день</p>
          )}
          <ul className="space-y-2">
            {sorted.map((ev) => (
              <li key={`${ev.type}-${ev.id}`}>
                <EventCard ev={ev} isTrainer={isTrainer} onOpen={openEvent} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="space-y-4">
          {week.days.map((d) => {
            const key = format(d, 'yyyy-MM-dd');
            const dayEvents = eventsByDay.get(key) ?? [];
            const isToday = isSameDay(d, new Date());
            return (
              <section
                key={key}
                ref={(el) => {
                  daySectionRefs.current[key] = el;
                }}
                className="scroll-mt-20"
              >
                <h2
                  className={cn(
                    'mb-2 text-sm font-medium',
                    isToday ? 'text-fitgo-300' : 'text-slate-300',
                  )}
                >
                  {format(d, 'EEEEEE, d MMM', { locale: ru })}
                  <span className="ml-2 text-slate-500">
                    · {dayEvents.length}
                  </span>
                </h2>
                {dayEvents.length === 0 ? (
                  <p className="px-1 text-xs text-slate-600">нет занятий</p>
                ) : (
                  <ul className="space-y-2">
                    {dayEvents.map((ev) => (
                      <li key={`${ev.type}-${ev.id}`}>
                        <EventCard
                          ev={ev}
                          isTrainer={isTrainer}
                          onOpen={openEvent}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {openSession ? (
        <BookingControlPanel
          key={openSession.sessionKey}
          api={panelApi}
          canResolve={!isTrainer}
          canMarkAttendance={!isTrainer}
          canTrainerSeen={isTrainer}
          canApproveGroup
          approvalActor={
            apiBase === 'super-admin'
              ? 'override'
              : isTrainer
                ? 'performer'
                : 'admin'
          }
          canBulkApprove={apiBase === 'super-admin'}
          canReturnApproval={!isTrainer}
          canManagerRework={apiBase === 'super-admin'}
          canViewHallPhotos
          detailOnly
          initialSessionKey={openSession.sessionKey}
          initialFrom={openSession.from}
          initialTo={openSession.to}
          cancelSpaBooking={
            isTrainer
              ? undefined
              : async (bookingId) => {
                  const token = getToken();
                  if (!token) throw new Error('Нет сессии');
                  await api.adminCancelSpaBooking(token, bookingId);
                }
          }
          onDetailClose={() => {
            setOpenSession(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
