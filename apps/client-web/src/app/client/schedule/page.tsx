'use client';

import type { Booking, ScheduleSlot } from '@fitgo/shared-types';
import confetti from 'canvas-confetti';
import { CalendarPlus, Filter, Share2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/forma/avatar';
import { Button } from '@/components/forma/button';
import { Chip } from '@/components/forma/chip';
import { DateStrip, type DateStripDay } from '@/components/forma/date-strip';
import { EmptyState } from '@/components/forma/empty-state';
import { SeatsMeter } from '@/components/forma/seats-meter';
import { Sheet } from '@/components/forma/sheet';
import { SkeletonCard } from '@/components/forma/skeleton';
import { useToast } from '@/components/forma/toast';
import { ModuleGate } from '@/components/module-gate';
import { useClubTheme } from '@/components/club-theme-provider';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { cancelGroupBooking } from '@/lib/cancel-booking';
import {
  TIME_OF_DAY_LABEL,
  addDaysKey,
  dayKey,
  durationLabel,
  lookupClass,
  timeOfDay,
  todayKey,
} from '@/lib/class-catalog';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { downloadIcsEvent } from '@/lib/ics';
import { cn } from '@/lib/utils';

const FILTERS_KEY = 'forma:schedule-group-filters';

type Period = '' | 'morning' | 'day' | 'evening';

export default function ClientSchedulePage() {
  return (
    <ModuleGate module="group_classes">
      <GroupScheduleInner />
    </ModuleGate>
  );
}

function GroupScheduleInner() {
  const toast = useToast();
  const theme = useClubTheme();
  const [slotsByWeek, setSlotsByWeek] = useState<Record<number, ScheduleSlot[]>>(
    {},
  );
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [crmStatus, setCrmStatus] = useState<'LINKED' | 'PENDING_CRM' | null>(
    null,
  );
  const [selectedDay, setSelectedDay] = useState(todayKey());
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('');
  const [mineOnly, setMineOnly] = useState(false);
  const [freeOnly, setFreeOnly] = useState(false);
  const [serviceFilter, setServiceFilter] = useState('');
  const [trainerFilter, setTrainerFilter] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<ScheduleSlot | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const canBook = crmStatus !== 'PENDING_CRM';

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FILTERS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        period?: Period;
        mineOnly?: boolean;
        freeOnly?: boolean;
        serviceFilter?: string;
        trainerFilter?: string;
      };
      if (parsed.period) setPeriod(parsed.period);
      if (parsed.mineOnly) setMineOnly(parsed.mineOnly);
      if (parsed.freeOnly) setFreeOnly(parsed.freeOnly);
      if (parsed.serviceFilter) setServiceFilter(parsed.serviceFilter);
      if (parsed.trainerFilter) setTrainerFilter(parsed.trainerFilter);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        FILTERS_KEY,
        JSON.stringify({
          period,
          mineOnly,
          freeOnly,
          serviceFilter,
          trainerFilter,
        }),
      );
    } catch {
      /* ignore */
    }
  }, [period, mineOnly, freeOnly, serviceFilter, trainerFilter]);

  const loadWeek = useCallback(async (weekOffset: number) => {
    const token = getToken();
    if (!token) return;
    const fromDate = new Date();
    fromDate.setHours(0, 0, 0, 0);
    fromDate.setDate(fromDate.getDate() + weekOffset * 7);
    const toDate = new Date(fromDate);
    toDate.setDate(toDate.getDate() + 7);
    const from = `${fromDate.toLocaleDateString('fr-CA')} 00:00`;
    const to = `${toDate.toLocaleDateString('fr-CA')} 00:00`;
    const schedule = await api.clientSchedule(token, { from, to });
    setSlotsByWeek((prev) => ({ ...prev, [weekOffset]: schedule }));
  }, []);

  const loadMeta = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    const [userBookings, dashboard] = await Promise.all([
      api.clientBookings(token),
      api.clientDashboard(token).catch(() => null),
    ]);
    setBookings(userBookings);
    if (dashboard) setCrmStatus(dashboard.crmStatus ?? null);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadWeek(0), loadWeek(1), loadWeek(2), loadMeta()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [loadMeta, loadWeek, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') void loadMeta();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [loadMeta]);

  const { pulling, refreshing } = usePullToRefresh(refresh);

  const allSlots = useMemo(
    () => Object.values(slotsByWeek).flat(),
    [slotsByWeek],
  );

  const bookedSessionIds = useMemo(
    () =>
      new Set(
        bookings
          .filter((b) => b.source === '1c' || !b.source)
          .filter((b) => b.lifecycle !== 'CANCELLED')
          .map((b) => b.sessionId),
      ),
    [bookings],
  );

  const dateStripDays: DateStripDay[] = useMemo(() => {
    const today = todayKey();
    return Array.from({ length: 21 }, (_, i) => {
      const key = addDaysKey(today, i);
      const daySlots = allSlots.filter((s) => dayKey(s.startAt) === key);
      const highlight = daySlots.some((s) => bookedSessionIds.has(s.id));
      return { key, count: daySlots.length, highlight };
    });
  }, [allSlots, bookedSessionIds]);

  const serviceOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const slot of allSlots) {
      if (slot.serviceId) map.set(slot.serviceId, slot.title);
    }
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [allSlots]);

  const trainerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const slot of allSlots) {
      if (slot.trainerId && slot.trainerName) {
        map.set(slot.trainerId, slot.trainerName);
      }
    }
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [allSlots]);

  const activeFilterCount =
    (period ? 1 : 0) +
    (mineOnly ? 1 : 0) +
    (freeOnly ? 1 : 0) +
    (serviceFilter ? 1 : 0) +
    (trainerFilter ? 1 : 0);

  const daySlots = useMemo(() => {
    return allSlots
      .filter((slot) => dayKey(slot.startAt) === selectedDay)
      .filter((slot) => {
        if (period && timeOfDay(slot.startAt) !== period) return false;
        if (mineOnly && !bookedSessionIds.has(slot.id)) return false;
        if (freeOnly && !slot.available) return false;
        if (serviceFilter && slot.serviceId !== serviceFilter) return false;
        if (trainerFilter && slot.trainerId !== trainerFilter) return false;
        return true;
      })
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  }, [
    allSlots,
    selectedDay,
    period,
    mineOnly,
    freeOnly,
    serviceFilter,
    trainerFilter,
    bookedSessionIds,
  ]);

  const grouped = useMemo(() => {
    const buckets: Record<'morning' | 'day' | 'evening', ScheduleSlot[]> = {
      morning: [],
      day: [],
      evening: [],
    };
    for (const slot of daySlots) {
      buckets[timeOfDay(slot.startAt)].push(slot);
    }
    return buckets;
  }, [daySlots]);

  const nearestDayWithClasses = useMemo(() => {
    return dateStripDays.find((d) => (d.count ?? 0) > 0 && d.key >= todayKey())
      ?.key;
  }, [dateStripDays]);

  const celebrate = (title: string, startAt: string) => {
    void confetti({
      particleCount: 70,
      spread: 60,
      origin: { y: 0.7 },
      colors: ['#FFD000', '#FFFFFF', '#FFE685'],
    });
    try {
      navigator.vibrate?.(40);
    } catch {
      /* ignore */
    }
    toast.success(`Вы записаны: ${title}`, {
      description: new Date(startAt).toLocaleString('ru-RU', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }),
      actionLabel: 'В календарь',
      onAction: () =>
        downloadIcsEvent({ title, startAt, location: 'Forma' }),
    });
  };

  const handleBook = async (slot: ScheduleSlot) => {
    const token = getToken();
    if (!token) return;
    setBusyId(slot.id);
    try {
      const result = await api.clientBook(token, slot.id);
      if (result.success) {
        setSlotsByWeek((prev) => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            const week = Number(key);
            next[week] = next[week].map((s) =>
              s.id === slot.id
                ? {
                    ...s,
                    booked: s.booked + 1,
                    available: s.booked + 1 < s.capacity,
                  }
                : s,
            );
          }
          return next;
        });
        await loadMeta();
        celebrate(slot.title, slot.startAt);
        setSelected(null);
      } else {
        toast.error(result.message ?? 'Не удалось записаться');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusyId(null);
    }
  };

  const handleJoinWaitlist = async (slot: ScheduleSlot) => {
    const token = getToken();
    if (!token) return;
    setBusyId(slot.id);
    try {
      const entry = await api.clientJoinWaitlist(token, slot.id);
      toast.info(
        entry.isFirstInQueue
          ? `Вы первые в очереди (#${entry.position})`
          : `В листе ожидания · позиция ${entry.position}`,
      );
      await refresh();
      setSelected(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusyId(null);
    }
  };

  const handleLeaveWaitlist = async (slot: ScheduleSlot) => {
    const token = getToken();
    if (!token) return;
    setBusyId(slot.id);
    try {
      await api.clientLeaveWaitlist(token, slot.id);
      toast.info('Вы вышли из листа ожидания');
      await refresh();
      setSelected(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmWaitlist = async (slot: ScheduleSlot) => {
    const token = getToken();
    if (!token) return;
    setBusyId(slot.id);
    try {
      const result = await api.clientConfirmWaitlist(token, slot.id);
      if (result.success) {
        celebrate(slot.title, slot.startAt);
        await refresh();
        setSelected(null);
      } else {
        toast.error(result.message ?? 'Не удалось подтвердить');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (slot: ScheduleSlot) => {
    setBusyId(slot.id);
    try {
      const result = await cancelGroupBooking(slot.id, slot.title, {
        skipConfirm: true,
      });
      if (result.success) {
        toast.success('Запись отменена');
        await refresh();
        setSelected(null);
        setConfirmCancel(false);
      } else if (result.message && result.message !== 'Отменено') {
        toast.error(result.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusyId(null);
    }
  };

  const resetFilters = () => {
    setPeriod('');
    setMineOnly(false);
    setFreeOnly(false);
    setServiceFilter('');
    setTrainerFilter('');
  };

  if (loading && allSlots.length === 0) {
    return (
      <div className="space-y-3">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(pulling || refreshing) && (
        <p className="text-center text-xs font-medium text-forma-400">
          {refreshing ? 'Обновление…' : 'Отпустите для обновления'}
        </p>
      )}
      {!canBook && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Запись откроется после оформления на ресепшен.
          {theme?.phone ? (
            <>
              {' '}
              <a href={`tel:${theme.phone}`} className="font-semibold text-forma-400">
                {theme.phone}
              </a>
            </>
          ) : null}
        </div>
      )}

      <DateStrip
        days={dateStripDays}
        value={selectedDay}
        onChange={setSelectedDay}
      />

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <Chip active={mineOnly} onClick={() => setMineOnly((v) => !v)}>
          Мои записи
        </Chip>
        <Chip active={freeOnly} onClick={() => setFreeOnly((v) => !v)}>
          Есть места
        </Chip>
        {(
          [
            ['morning', 'Утро'],
            ['day', 'День'],
            ['evening', 'Вечер'],
          ] as const
        ).map(([value, label]) => (
          <Chip
            key={value}
            active={period === value}
            onClick={() => setPeriod((p) => (p === value ? '' : value))}
          >
            {label}
          </Chip>
        ))}
        <Chip
          active={activeFilterCount > 0}
          count={activeFilterCount || undefined}
          onClick={() => setFiltersOpen(true)}
        >
          <Filter className="h-3.5 w-3.5" />
          Фильтры
        </Chip>
      </div>

      {daySlots.length === 0 ? (
        <EmptyState
          title={
            activeFilterCount > 0
              ? 'Ничего не найдено'
              : 'В этот день занятий нет'
          }
          description={
            activeFilterCount > 0
              ? 'Сбросьте фильтры или выберите другой день'
              : nearestDayWithClasses
                ? undefined
                : 'На ближайшие дни расписание пока пустое'
          }
          actionLabel={
            activeFilterCount > 0
              ? 'Сбросить фильтры'
              : nearestDayWithClasses
                ? 'К ближайшему занятию'
                : undefined
          }
          onAction={
            activeFilterCount > 0
              ? resetFilters
              : nearestDayWithClasses
                ? () => setSelectedDay(nearestDayWithClasses)
                : undefined
          }
        />
      ) : (
        <div className="space-y-5">
          {(['morning', 'day', 'evening'] as const).map((bucket) => {
            const list = grouped[bucket];
            if (!list.length) return null;
            return (
              <section key={bucket}>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
                  {TIME_OF_DAY_LABEL[bucket]}
                </h3>
                <ul className="space-y-2.5">
                  {list.map((slot) => (
                    <ClassCard
                      key={slot.id}
                      slot={slot}
                      booked={bookedSessionIds.has(slot.id)}
                      canBook={canBook}
                      busy={busyId === slot.id}
                      onOpen={() => {
                        setConfirmCancel(false);
                        setSelected(slot);
                      }}
                      onQuickBook={() => void handleBook(slot)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <Sheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title="Фильтры"
        description="Направления и тренеры"
      >
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm text-zinc-400">Направление</p>
            <div className="flex flex-wrap gap-2">
              <Chip
                active={!serviceFilter}
                onClick={() => setServiceFilter('')}
              >
                Все
              </Chip>
              {serviceOptions.map((opt) => (
                <Chip
                  key={opt.value}
                  active={serviceFilter === opt.value}
                  onClick={() =>
                    setServiceFilter((v) => (v === opt.value ? '' : opt.value))
                  }
                >
                  {opt.label}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm text-zinc-400">Тренер</p>
            <div className="flex flex-wrap gap-2">
              <Chip
                active={!trainerFilter}
                onClick={() => setTrainerFilter('')}
              >
                Все
              </Chip>
              {trainerOptions.map((opt) => (
                <Chip
                  key={opt.value}
                  active={trainerFilter === opt.value}
                  onClick={() =>
                    setTrainerFilter((v) => (v === opt.value ? '' : opt.value))
                  }
                >
                  {opt.label}
                </Chip>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={resetFilters}>
              Сбросить
            </Button>
            <Button className="flex-1" onClick={() => setFiltersOpen(false)}>
              Готово
            </Button>
          </div>
        </div>
      </Sheet>

      <ClassSheet
        slot={selected}
        booked={selected ? bookedSessionIds.has(selected.id) : false}
        canBook={canBook}
        busy={selected ? busyId === selected.id : false}
        confirmCancel={confirmCancel}
        onConfirmCancelChange={setConfirmCancel}
        onClose={() => {
          setSelected(null);
          setConfirmCancel(false);
        }}
        onBook={() => selected && void handleBook(selected)}
        onWaitlist={() => selected && void handleJoinWaitlist(selected)}
        onLeaveWaitlist={() => selected && void handleLeaveWaitlist(selected)}
        onConfirmWaitlist={() =>
          selected && void handleConfirmWaitlist(selected)
        }
        onCancel={() => selected && void handleCancel(selected)}
      />
    </div>
  );
}

function ClassCard({
  slot,
  booked,
  canBook,
  busy,
  onOpen,
  onQuickBook,
}: {
  slot: ScheduleSlot;
  booked: boolean;
  canBook: boolean;
  busy: boolean;
  onOpen: () => void;
  onQuickBook: () => void;
}) {
  const info = lookupClass(slot.title);
  const start = new Date(slot.startAt);
  const time = start.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const dur = durationLabel(slot.startAt, slot.endAt);
  const now = Date.now();
  const startMs = start.getTime();
  const endMs = new Date(slot.endAt).getTime();
  const isLive = now >= startMs && now <= endMs;
  const isPast = now > endMs;
  const wl = slot.waitlist;

  return (
    <div
      className={cn(
        'card relative overflow-hidden p-0 transition',
        isPast && 'opacity-55',
      )}
    >
      <div
        className="absolute bottom-0 left-0 top-0 w-1.5"
        style={{ background: info.accent }}
      />
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full gap-3 p-3.5 pl-4 text-left touch-manipulation"
      >
        <div className="w-14 shrink-0 pt-0.5">
          <p className="font-display text-lg font-bold tabular-nums text-white">
            {time}
          </p>
          {dur ? <p className="text-[11px] text-zinc-500">{dur}</p> : null}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-display font-semibold text-white">{slot.title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {slot.trainerName ? (
                  <span className="inline-flex items-center gap-1.5 text-sm text-zinc-400">
                    <Avatar name={slot.trainerName} size="sm" className="!h-6 !w-6 !text-[9px]" />
                    {slot.trainerName}
                  </span>
                ) : null}
                {slot.roomTitle ? (
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400">
                    {slot.roomTitle}
                  </span>
                ) : null}
              </div>
            </div>
            {booked ? (
              <span className="shrink-0 rounded-full bg-forma-500/15 px-2 py-0.5 text-[11px] font-semibold text-forma-400">
                Вы записаны
              </span>
            ) : wl?.canConfirm ? (
              <span className="animate-pulse-soft shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                Место свободно
              </span>
            ) : wl?.userPosition ? (
              <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">
                Очередь #{wl.userPosition}
              </span>
            ) : isLive ? (
              <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                Идёт
              </span>
            ) : null}
          </div>
          <SeatsMeter
            booked={slot.booked}
            capacity={slot.capacity}
            waitlistCount={wl?.open ? wl.count : undefined}
          />
        </div>
      </button>
      {!booked && slot.available && !isPast && (
        <div className="border-t border-white/[0.06] px-3.5 py-2.5 pl-4">
          <Button
            size="sm"
            className="w-full"
            disabled={!canBook || busy}
            loading={busy}
            onClick={onQuickBook}
          >
            {!canBook ? 'Нужна карта 1С' : 'Записаться'}
          </Button>
        </div>
      )}
      {!booked && !slot.available && wl?.open && !isPast && (
        <div className="border-t border-white/[0.06] px-3.5 py-2.5 pl-4">
          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            disabled={!canBook || busy}
            onClick={onOpen}
          >
            В лист ожидания
          </Button>
        </div>
      )}
    </div>
  );
}

function ClassSheet({
  slot,
  booked,
  canBook,
  busy,
  confirmCancel,
  onConfirmCancelChange,
  onClose,
  onBook,
  onWaitlist,
  onLeaveWaitlist,
  onConfirmWaitlist,
  onCancel,
}: {
  slot: ScheduleSlot | null;
  booked: boolean;
  canBook: boolean;
  busy: boolean;
  confirmCancel: boolean;
  onConfirmCancelChange: (v: boolean) => void;
  onClose: () => void;
  onBook: () => void;
  onWaitlist: () => void;
  onLeaveWaitlist: () => void;
  onConfirmWaitlist: () => void;
  onCancel: () => void;
}) {
  const info = slot ? lookupClass(slot.title) : null;
  const wl = slot?.waitlist;

  return (
    <Sheet
      open={!!slot}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={slot?.title}
      description={
        slot
          ? new Date(slot.startAt).toLocaleString('ru-RU', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
            })
          : undefined
      }
    >
      {slot && info ? (
        <div className="space-y-4">
          <div
            className="rounded-2xl p-4"
            style={{ background: `${info.accent}22` }}
          >
            <p className="text-sm text-zinc-200">{info.blurb}</p>
            <p className="mt-2 text-xs text-zinc-400">
              Интенсивность:{' '}
              {'●'.repeat(info.intensity)}
              {'○'.repeat(5 - info.intensity)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            {slot.trainerName ? (
              <div className="rounded-2xl bg-ink-raised p-3">
                <p className="text-zinc-500">Тренер</p>
                <p className="mt-0.5 font-medium text-white">{slot.trainerName}</p>
              </div>
            ) : null}
            {slot.roomTitle ? (
              <div className="rounded-2xl bg-ink-raised p-3">
                <p className="text-zinc-500">Зал</p>
                <p className="mt-0.5 font-medium text-white">{slot.roomTitle}</p>
              </div>
            ) : null}
            <div className="rounded-2xl bg-ink-raised p-3">
              <p className="text-zinc-500">Длительность</p>
              <p className="mt-0.5 font-medium text-white">
                {durationLabel(slot.startAt, slot.endAt) ?? '—'}
              </p>
            </div>
            <div className="rounded-2xl bg-ink-raised p-3">
              <p className="text-zinc-500">Места</p>
              <p className="mt-0.5 font-medium text-white">
                {slot.booked}/{slot.capacity}
              </p>
            </div>
          </div>

          <SeatsMeter
            booked={slot.booked}
            capacity={slot.capacity}
            waitlistCount={wl?.open ? wl.count : undefined}
          />

          {booked ? (
            confirmCancel ? (
              <div className="space-y-2">
                <p className="text-sm text-zinc-400">
                  Отменить запись на «{slot.title}»?
                </p>
                <Button
                  className="w-full"
                  variant="danger"
                  loading={busy}
                  onClick={onCancel}
                >
                  Да, отменить
                </Button>
                <Button
                  className="w-full"
                  variant="secondary"
                  onClick={() => onConfirmCancelChange(false)}
                >
                  Не отменять
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="rounded-2xl bg-forma-500/10 px-3 py-2 text-center text-sm font-medium text-forma-400">
                  Вы записаны
                </div>
                <Button
                  className="w-full"
                  variant="secondary"
                  onClick={() => onConfirmCancelChange(true)}
                >
                  Отменить запись
                </Button>
              </div>
            )
          ) : wl?.canConfirm ? (
            <div className="space-y-2">
              <p className="text-sm text-amber-300">
                Освободилось место — подтвердите запись
              </p>
              <Button className="w-full" loading={busy} onClick={onConfirmWaitlist}>
                Подтвердить запись
              </Button>
              <Button
                className="w-full"
                variant="secondary"
                disabled={busy}
                onClick={onLeaveWaitlist}
              >
                Отказаться
              </Button>
            </div>
          ) : wl?.userPosition ? (
            <div className="space-y-2">
              <p className="text-sm text-amber-300">
                {wl.isFirstInQueue
                  ? `Вы первые в очереди (#${wl.userPosition})`
                  : `В листе ожидания · позиция ${wl.userPosition}`}
              </p>
              <Button
                className="w-full"
                variant="secondary"
                loading={busy}
                onClick={onLeaveWaitlist}
              >
                Выйти из очереди
              </Button>
            </div>
          ) : slot.available ? (
            <Button
              className="w-full"
              size="lg"
              disabled={!canBook}
              loading={busy}
              onClick={onBook}
            >
              {!canBook ? 'Нужна карта 1С' : 'Записаться'}
            </Button>
          ) : wl?.open ? (
            <Button
              className="w-full"
              size="lg"
              disabled={!canBook}
              loading={busy}
              onClick={onWaitlist}
            >
              {!canBook ? 'Нужна карта 1С' : 'В лист ожидания'}
            </Button>
          ) : (
            <Button className="w-full" disabled>
              Мест нет
            </Button>
          )}

          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() =>
                downloadIcsEvent({
                  title: slot.title,
                  startAt: slot.startAt,
                  endAt: slot.endAt,
                  location: slot.roomTitle ?? 'Forma',
                  description: slot.trainerName
                    ? `Тренер: ${slot.trainerName}`
                    : undefined,
                })
              }
            >
              <CalendarPlus className="h-4 w-4" />
              В календарь
            </Button>
            {typeof navigator !== 'undefined' && navigator.share ? (
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => {
                  void navigator.share({
                    title: slot.title,
                    text: `${slot.title} · ${new Date(slot.startAt).toLocaleString('ru-RU')}`,
                  });
                }}
              >
                <Share2 className="h-4 w-4" />
                Поделиться
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}
