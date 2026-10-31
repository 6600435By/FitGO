'use client';

import type { PersonalTrainingSlot, TrainerSummary } from '@fitgo/shared-types';
import confetti from 'canvas-confetti';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/forma/avatar';
import { Button } from '@/components/forma/button';
import { DateStrip, type DateStripDay } from '@/components/forma/date-strip';
import { EmptyState } from '@/components/forma/empty-state';
import { Sheet } from '@/components/forma/sheet';
import { SkeletonCard } from '@/components/forma/skeleton';
import { useToast } from '@/components/forma/toast';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import {
  TIME_OF_DAY_LABEL,
  dayKey,
  durationLabel,
  timeOfDay,
  todayKey,
} from '@/lib/class-catalog';
import { downloadIcsEvent } from '@/lib/ics';
import { cn } from '@/lib/utils';

type SlotWithTrainer = PersonalTrainingSlot & {
  trainerId: string;
  trainerName: string;
};

export default function ClientPersonalSchedulePage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-3">
          <SkeletonCard />
        </div>
      }
    >
      <PersonalInner />
    </Suspense>
  );
}

function PersonalInner() {
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const trainerParam = searchParams.get('trainer');

  const [trainers, setTrainers] = useState<TrainerSummary[]>([]);
  const [selectedTrainerId, setSelectedTrainerId] = useState<string | 'ALL'>(
    'ALL',
  );
  const [slots, setSlots] = useState<SlotWithTrainer[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [pending, setPending] = useState<SlotWithTrainer | null>(null);
  const [busy, setBusy] = useState(false);

  const loadTrainers = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const list = await api.clientTrainers(token);
      setTrainers(list);
      if (trainerParam && list.some((t) => t.id === trainerParam)) {
        setSelectedTrainerId(trainerParam);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, [toast, trainerParam]);

  useEffect(() => {
    void loadTrainers();
  }, [loadTrainers]);

  const { pulling, refreshing } = usePullToRefresh(loadTrainers);

  useEffect(() => {
    const token = getToken();
    if (!token || trainers.length === 0) {
      setSlots([]);
      return;
    }

    const targets =
      selectedTrainerId === 'ALL'
        ? trainers.filter((t) => t.hasSchedule)
        : trainers.filter((t) => t.id === selectedTrainerId);

    if (targets.length === 0) {
      setSlots([]);
      return;
    }

    setLoadingSlots(true);
    Promise.all(
      targets.map((tr) =>
        api
          .clientTrainerSlots(token, tr.id)
          .then((list) =>
            list.map((slot) => ({
              ...slot,
              trainerId: tr.id,
              trainerName: `${tr.firstName} ${tr.lastName}`.trim(),
            })),
          )
          .catch(() => [] as SlotWithTrainer[]),
      ),
    )
      .then((lists) => {
        const merged = lists
          .flat()
          .sort((a, b) => a.startAt.localeCompare(b.startAt));
        setSlots(merged);
      })
      .finally(() => setLoadingSlots(false));
  }, [selectedTrainerId, trainers]);

  const dateStripDays: DateStripDay[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const slot of slots) {
      const key = dayKey(slot.startAt);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => ({ key, count }));
  }, [slots]);

  useEffect(() => {
    if (dateStripDays.length === 0) {
      setSelectedDay(null);
      return;
    }
    setSelectedDay((prev) => {
      if (prev && dateStripDays.some((d) => d.key === prev)) return prev;
      const today = todayKey();
      return dateStripDays.find((d) => d.key >= today)?.key ?? dateStripDays[0].key;
    });
  }, [dateStripDays]);

  const daySlots = useMemo(() => {
    if (!selectedDay) return [];
    return slots.filter((s) => dayKey(s.startAt) === selectedDay);
  }, [slots, selectedDay]);

  const grouped = useMemo(() => {
    const buckets: Record<'morning' | 'day' | 'evening', SlotWithTrainer[]> = {
      morning: [],
      day: [],
      evening: [],
    };
    for (const slot of daySlots) {
      buckets[timeOfDay(slot.startAt)].push(slot);
    }
    return buckets;
  }, [daySlots]);

  const nearestByTrainer = useMemo(() => {
    const map = new Map<string, string>();
    const now = Date.now();
    for (const slot of slots) {
      if (new Date(slot.startAt).getTime() < now) continue;
      if (!map.has(slot.trainerId)) map.set(slot.trainerId, slot.startAt);
    }
    return map;
  }, [slots]);

  const confirmBook = async () => {
    const token = getToken();
    if (!token || !pending) return;
    setBusy(true);
    try {
      const booking = await api.clientBookPersonal(
        token,
        pending.trainerId,
        pending.startAt,
      );
      void confetti({
        particleCount: 80,
        spread: 65,
        origin: { y: 0.7 },
        colors: ['#FFD000', '#FFFFFF'],
      });
      toast.success('Вы записаны на персональную', {
        actionLabel: 'Открыть тренировку',
        onAction: () =>
          router.push(`/client/personal-bookings/${booking.id}`),
      });
      setSlots((prev) =>
        prev.filter(
          (s) =>
            !(
              s.trainerId === pending.trainerId &&
              s.startAt === pending.startAt
            ),
        ),
      );
      setPending(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка записи');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <SkeletonCard />
      </div>
    );
  }

  if (trainers.length === 0) {
    return (
      <EmptyState
        title="Нет тренеров с расписанием"
        description="Как только тренер откроет окна — они появятся здесь"
      />
    );
  }

  return (
    <div className="space-y-4">
      {(pulling || refreshing) && (
        <p className="text-center text-xs font-medium text-forma-400">
          {refreshing ? 'Обновление…' : 'Отпустите для обновления'}
        </p>
      )}
      <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1">
        <button
          type="button"
          onClick={() => setSelectedTrainerId('ALL')}
          className={cn(
            'flex w-[7.5rem] shrink-0 flex-col items-center rounded-3xl border px-2 py-3 text-center transition',
            selectedTrainerId === 'ALL'
              ? 'border-forma-500 bg-forma-500 text-ink shadow-forma-glow'
              : 'border-white/10 bg-ink-elevated text-zinc-300',
          )}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink/10 font-display text-sm font-bold">
            Все
          </span>
          <span className="mt-2 text-xs font-semibold">Любой тренер</span>
        </button>
        {trainers.map((tr) => {
          const name = `${tr.firstName} ${tr.lastName}`.trim();
          const next = nearestByTrainer.get(tr.id);
          const active = selectedTrainerId === tr.id;
          return (
            <button
              key={tr.id}
              type="button"
              onClick={() => setSelectedTrainerId(tr.id)}
              className={cn(
                'flex w-[8.5rem] shrink-0 flex-col items-center rounded-3xl border px-2 py-3 text-center transition',
                active
                  ? 'border-forma-500 bg-forma-500/15 text-white'
                  : 'border-white/10 bg-ink-elevated text-zinc-300',
              )}
            >
              <Avatar name={name} size="lg" />
              <span className="mt-2 line-clamp-2 text-xs font-semibold leading-tight">
                {tr.firstName}
                <br />
                {tr.lastName}
              </span>
              <span
                className={cn(
                  'mt-1 text-[10px]',
                  active ? 'text-forma-300' : 'text-zinc-500',
                )}
              >
                {next
                  ? `ближ. ${new Date(next).toLocaleString('ru-RU', {
                      weekday: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : tr.hasSchedule
                    ? 'нет окон'
                    : 'нет расписания'}
              </span>
            </button>
          );
        })}
      </div>

      {loadingSlots ? (
        <SkeletonCard />
      ) : dateStripDays.length === 0 ? (
        <EmptyState
          title="Нет свободных слотов"
          description="На ближайшие две недели окон нет"
        />
      ) : (
        <>
          <DateStrip
            days={dateStripDays}
            value={selectedDay}
            onChange={setSelectedDay}
          />

          {daySlots.length === 0 ? (
            <EmptyState title="На этот день окон нет" />
          ) : (
            <div className="space-y-4">
              {(['morning', 'day', 'evening'] as const).map((bucket) => {
                const list = grouped[bucket];
                if (!list.length) return null;
                return (
                  <section key={bucket}>
                    <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
                      {TIME_OF_DAY_LABEL[bucket]}
                    </h3>
                    <div className="grid grid-cols-3 gap-2">
                      {list.map((slot) => {
                        const time = new Date(slot.startAt).toLocaleTimeString(
                          'ru-RU',
                          { hour: '2-digit', minute: '2-digit' },
                        );
                        return (
                          <button
                            key={`${slot.trainerId}:${slot.startAt}`}
                            type="button"
                            onClick={() => setPending(slot)}
                            className="rounded-2xl border border-white/10 bg-ink-elevated px-2 py-3 text-center transition hover:border-forma-500/50 touch-manipulation"
                          >
                            <span className="block font-display text-base font-bold tabular-nums text-white">
                              {time}
                            </span>
                            {selectedTrainerId === 'ALL' ? (
                              <span className="mt-1 block text-[11px] text-zinc-500">
                                {slot.trainerName.split(' ')[0]}
                              </span>
                            ) : (
                              <span className="mt-1 block text-[11px] text-zinc-500">
                                {durationLabel(slot.startAt, slot.endAt) ??
                                  '60 мин'}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      <Sheet
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title="Подтверждение"
        description="Персональная тренировка"
      >
        {pending ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={pending.trainerName} size="lg" />
              <div>
                <p className="font-display text-lg font-semibold text-white">
                  {pending.trainerName}
                </p>
                <p className="text-sm text-zinc-400">
                  {new Date(pending.startAt).toLocaleString('ru-RU', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                <p className="text-sm text-zinc-500">
                  {durationLabel(pending.startAt, pending.endAt) ?? '60 мин'}
                </p>
              </div>
            </div>
            <Button className="w-full" size="lg" loading={busy} onClick={() => void confirmBook()}>
              Записаться
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() =>
                downloadIcsEvent({
                  title: `ПТ · ${pending.trainerName}`,
                  startAt: pending.startAt,
                  endAt: pending.endAt,
                  location: 'Forma',
                })
              }
            >
              Добавить в календарь
            </Button>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
