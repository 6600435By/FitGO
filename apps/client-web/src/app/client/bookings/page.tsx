'use client';

import type { Booking } from '@fitgo/shared-types';
import { SessionType, originBadgeLabel } from '@fitgo/shared-types';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/forma/avatar';
import { Button } from '@/components/forma/button';
import { Countdown } from '@/components/forma/countdown';
import { EmptyState } from '@/components/forma/empty-state';
import { PageHeader } from '@/components/forma/page-header';
import { SegmentedControl } from '@/components/forma/segmented-control';
import { Sheet } from '@/components/forma/sheet';
import { SkeletonCard } from '@/components/forma/skeleton';
import { useToast } from '@/components/forma/toast';
import { api } from '@/lib/api';
import { cancelClientBooking } from '@/lib/cancel-booking';
import { getToken } from '@/lib/auth';
import { formatDateTime, sessionTypeLabel } from '@/lib/utils';

type Tab = 'upcoming' | 'past';

export default function ClientBookingsPage() {
  const toast = useToast();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('upcoming');
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = () => {
    const token = getToken();
    if (!token) return;
    api
      .clientBookings(token)
      .then(setBookings)
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upcoming = useMemo(
    () =>
      bookings.filter(
        (b) =>
          b.lifecycle !== 'CANCELLED' && new Date(b.startAt) >= new Date(),
      ),
    [bookings],
  );
  const past = useMemo(
    () =>
      bookings.filter(
        (b) =>
          b.lifecycle === 'CANCELLED' || new Date(b.startAt) < new Date(),
      ),
    [bookings],
  );

  const list = tab === 'upcoming' ? upcoming : past;

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const result = await cancelClientBooking(cancelTarget, {
        skipConfirm: true,
      });
      if (result.success) {
        toast.success(
          cancelTarget.type === SessionType.SPA
            ? 'Запись в SPA отменена'
            : 'Запись отменена',
        );
        setCancelTarget(null);
        load();
      } else if (result.message && result.message !== 'Отменено') {
        toast.error(result.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Мои записи"
        action={
          <Link href="/client/booking-history" className="text-sm text-forma-400">
            История →
          </Link>
        }
      />

      <SegmentedControl
        layoutId="bookings-tabs"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'upcoming', label: `Предстоящие${upcoming.length ? ` · ${upcoming.length}` : ''}` },
          { value: 'past', label: 'История' },
        ]}
      />

      {list.length === 0 ? (
        <EmptyState
          title={
            tab === 'upcoming' ? 'Нет предстоящих записей' : 'Пока пусто'
          }
          actionLabel={tab === 'upcoming' ? 'Открыть расписание' : undefined}
          onAction={
            tab === 'upcoming'
              ? () => {
                  window.location.href = '/client/schedule';
                }
              : undefined
          }
        />
      ) : (
        <ul className="space-y-3">
          {list.map((booking) => (
            <li key={booking.id} className="card space-y-3">
              <div className="flex items-start gap-3">
                <Avatar
                  name={booking.trainerName || booking.title}
                  size="lg"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg font-semibold text-white">
                    {booking.title}
                  </p>
                  <p className="text-sm text-zinc-400">
                    {formatDateTime(booking.startAt)}
                  </p>
                  {booking.trainerName ? (
                    <p className="text-sm text-zinc-500">{booking.trainerName}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400">
                      {sessionTypeLabel(booking.type)}
                    </span>
                    {originBadgeLabel(booking.origin) ? (
                      <span className="rounded-full bg-forma-500/15 px-2 py-0.5 text-[11px] text-forma-400">
                        {originBadgeLabel(booking.origin)}
                      </span>
                    ) : null}
                    {booking.usage?.paymentStatus === 'DEBT' ? (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300">
                        Долг
                      </span>
                    ) : null}
                    {booking.lifecycle === 'CANCELLED' ? (
                      <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] text-rose-300">
                        Отменена
                      </span>
                    ) : null}
                  </div>
                </div>
                {tab === 'upcoming' && booking.lifecycle !== 'CANCELLED' ? (
                  <Countdown to={booking.startAt} compact />
                ) : null}
              </div>

              {booking.source === 'fitgo' &&
                booking.type === SessionType.PERSONAL && (
                  <Link
                    href={`/client/personal-bookings/${booking.sessionId}`}
                    className="btn-primary block w-full text-center"
                  >
                    {booking.lifecycle === 'AWAITING_CONFIRMATION'
                      ? 'Завершить тренировку'
                      : 'План тренировки'}
                  </Link>
                )}

              {tab === 'upcoming' && booking.lifecycle !== 'CANCELLED' ? (
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => setCancelTarget(booking)}
                >
                  Отменить запись
                </Button>
              ) : null}

              {booking.lifecycle === 'CANCELLED' && booking.cancelledByLabel ? (
                <p className="text-xs text-zinc-500">{booking.cancelledByLabel}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={!!cancelTarget}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        title="Отменить запись?"
        description={
          cancelTarget
            ? `«${cancelTarget.title}» · ${formatDateTime(cancelTarget.startAt)}`
            : undefined
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">
            Место освободится для других клиентов. Администратор будет уведомлён.
          </p>
          <Button
            className="w-full"
            variant="danger"
            loading={cancelling}
            onClick={() => void handleCancel()}
          >
            Да, отменить
          </Button>
          <Button
            className="w-full"
            variant="secondary"
            onClick={() => setCancelTarget(null)}
          >
            Оставить запись
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
