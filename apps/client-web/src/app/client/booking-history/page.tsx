'use client';

import type { Booking } from '@fitgo/shared-types';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Chip } from '@/components/forma/chip';
import { EmptyState } from '@/components/forma/empty-state';
import { PageHeader } from '@/components/forma/page-header';
import { SkeletonCard } from '@/components/forma/skeleton';
import { useToast } from '@/components/forma/toast';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime, sessionTypeLabel } from '@/lib/utils';

type HistoryFilter = 'all' | 'upcoming' | 'completed' | 'cancelled';

const FILTERS: { id: HistoryFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'upcoming', label: 'Предстоящие' },
  { id: 'completed', label: 'Завершённые' },
  { id: 'cancelled', label: 'Отменённые' },
];

const LIFECYCLE_LABELS = {
  UPCOMING: 'Предстоящая',
  COMPLETED: 'Завершена',
  CANCELLED: 'Отменена',
  AWAITING_CONFIRMATION: 'Ожидает подтверждения',
};

export default function ClientBookingHistoryPage() {
  const toast = useToast();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;

    setLoading(true);
    api
      .clientBookingHistory(token, filter)
      .then(setBookings)
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [filter, toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="История записей"
        action={
          <Link href="/client/bookings" className="text-sm text-forma-400">
            Активные →
          </Link>
        }
      />

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {FILTERS.map((f) => (
          <Chip
            key={f.id}
            active={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </Chip>
        ))}
      </div>

      {loading ? (
        <SkeletonCard />
      ) : bookings.length === 0 ? (
        <EmptyState
          title="Нет записей"
          description="По выбранному фильтру ничего нет"
          actionLabel="Записаться"
          onAction={() => {
            window.location.href = '/client/schedule';
          }}
        />
      ) : (
        <ul className="space-y-3">
          {bookings.map((booking) => (
            <li key={`${booking.source}-${booking.id}`} className="card">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <p className="font-display font-semibold text-white">
                    {booking.title}
                  </p>
                  <p className="text-sm text-zinc-400">
                    {formatDateTime(booking.startAt)}
                  </p>
                  {booking.trainerName ? (
                    <p className="text-sm text-zinc-500">{booking.trainerName}</p>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="rounded-full bg-ink-raised px-2 py-1 text-xs text-zinc-400">
                    {sessionTypeLabel(booking.type)}
                  </span>
                  {booking.lifecycle ? (
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${
                        booking.lifecycle === 'UPCOMING'
                          ? 'bg-forma-500/10 text-forma-400'
                          : booking.lifecycle === 'CANCELLED'
                            ? 'bg-rose-500/10 text-rose-300'
                            : 'bg-ink-raised text-zinc-300'
                      }`}
                    >
                      {LIFECYCLE_LABELS[booking.lifecycle]}
                    </span>
                  ) : null}
                </div>
              </div>
              {booking.lifecycle === 'CANCELLED' && booking.cancelledByLabel ? (
                <p className="text-xs text-zinc-500">{booking.cancelledByLabel}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
