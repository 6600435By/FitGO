'use client';

import { MembershipStatus, SessionType, type Booking, type GamificationProfile, type Visit } from '@fitgo/shared-types';
import { Calendar, CreditCard, ChevronRight, Dumbbell, ShoppingBag, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MessagesHomeLink } from '@/components/messages-home-link';
import { ClientTrainerInvites } from '@/components/client/client-trainer-invites';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import {
  formatDate,
  formatDateTime,
  membershipProgress,
  membershipStatusColor,
  membershipStatusLabel,
} from '@/lib/utils';

function clientWorkoutHref(booking: Booking): string | null {
  if (booking.source === 'fitgo' && booking.type === SessionType.PERSONAL) {
    return `/client/personal-bookings/${booking.sessionId}`;
  }
  return null;
}

interface DashboardData {
  membership: {
    name: string;
    status: MembershipStatus;
    visitsRemaining?: number;
    visitsTotal?: number;
    validFrom: string;
    validUntil: string;
  } | null;
  visits: Visit[];
  club: { name: string; address?: string } | null;
}

export default function ClientHomePage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [upcomingBookings, setUpcomingBookings] = useState<Booking[]>([]);
  const [gamification, setGamification] = useState<GamificationProfile | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    api
      .clientDashboard(token)
      .then(setData)
      .catch((err) => setError(err.message));

    api
      .clientBookings(token)
      .then((bookings) => {
        const upcoming = bookings
          .filter((b) => new Date(b.startAt) >= new Date())
          .sort((a, b) => a.startAt.localeCompare(b.startAt));
        setUpcomingBookings(upcoming.slice(0, 4));
      })
      .catch(() => {});

    api.gamification(token).then(setGamification).catch(() => {});
  }, []);

  if (error) {
    return <p className="text-red-400">{error}</p>;
  }

  if (!data) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  const { membership, visits, club } = data;
  const progress = membership
    ? membershipProgress(membership.validFrom, membership.validUntil)
    : null;

  return (
    <div className="space-y-4">
      <ClientTrainerInvites />

      {club && (
        <div className="card">
          <p className="text-sm text-slate-400">Ваш клуб</p>
          <p className="text-xl font-semibold">{club.name}</p>
          {club.address && (
            <p className="mt-1 text-sm text-slate-400">{club.address}</p>
          )}
        </div>
      )}

      {upcomingBookings.length > 0 ? (
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-fitgo-400">Ближайшие записи</p>
            <Link href="/client/bookings" className="text-sm text-fitgo-400">
              Все →
            </Link>
          </div>
          <ul className="space-y-2">
            {upcomingBookings.map((booking) => {
              const workoutHref = clientWorkoutHref(booking);
              const inner = (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{booking.title}</p>
                    <p className="text-sm text-slate-400">
                      {formatDateTime(booking.startAt)}
                    </p>
                    {booking.trainerName && (
                      <p className="text-sm text-slate-400">{booking.trainerName}</p>
                    )}
                    {workoutHref && (
                      <p className="mt-0.5 text-xs text-fitgo-400">План тренировки</p>
                    )}
                  </div>
                  {workoutHref && (
                    <ChevronRight className="h-4 w-4 shrink-0 text-fitgo-400" />
                  )}
                </>
              );

              return (
                <li key={booking.id}>
                  {workoutHref ? (
                    <Link
                      href={workoutHref}
                      className={`block rounded-xl px-3 py-2 transition hover:bg-slate-800/80 ${
                        upcomingBookings[0]?.id === booking.id
                          ? 'border border-fitgo-500/30 bg-fitgo-500/5'
                          : 'bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">{inner}</div>
                    </Link>
                  ) : (
                    <div className="rounded-xl bg-slate-800/50 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">{inner}</div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <Link href="/client/schedule" className="card block text-center">
          <p className="text-slate-400">Нет предстоящих записей</p>
          <span className="btn-primary mt-3 inline-block">Записаться на групповое</span>
        </Link>
      )}

      {membership ? (
        <div className="card">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <p className="text-sm text-slate-400">Абонемент</p>
              <p className="text-xl font-semibold">{membership.name}</p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${membershipStatusColor(membership.status)}`}
            >
              {membershipStatusLabel(membership.status)}
            </span>
          </div>

          {progress && (
            <div className="mb-3">
              <div className="mb-1 flex justify-between text-xs text-slate-400">
                <span>Осталось {progress.daysLeft} дн.</span>
                <span>{progress.percent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-fitgo-500"
                  style={{ width: `${100 - progress.percent}%` }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-800/50 p-3">
              <p className="stat-label">Действует до</p>
              <p className="stat-value text-lg">
                {formatDate(membership.validUntil)}
              </p>
            </div>
            {membership.visitsRemaining !== undefined ? (
              <div className="rounded-xl bg-slate-800/50 p-3">
                <p className="stat-label">Осталось визитов</p>
                <p className="stat-value text-lg">
                  {membership.visitsRemaining}
                  {membership.visitsTotal ? ` / ${membership.visitsTotal}` : ''}
                </p>
              </div>
            ) : (
              <div className="rounded-xl bg-slate-800/50 p-3">
                <p className="stat-label">Тип</p>
                <p className="stat-value text-lg">Безлимит</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card text-center">
          <p className="text-slate-400">
            {club
              ? 'Абонемент не найден'
              : 'Клуб не подключён — персональные тренировки доступны без абонемента'}
          </p>
          {club && (
            <Link href="/client/products" className="btn-primary mt-4 inline-block">
              Купить абонемент
            </Link>
          )}
        </div>
      )}

      {gamification?.activated && (
        <div className="card space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-fitgo-400" />
              <span className="font-semibold">
                {gamification.league?.tierLabel ?? 'Бронза'}
              </span>
            </div>
            {gamification.league?.myRank && (
              <span className="text-sm text-slate-400">
                #{gamification.league.myRank} в группе
              </span>
            )}
          </div>
          {gamification.decayWarning && (
            <p className="text-xs text-yellow-400">{gamification.decayWarning.message}</p>
          )}
          <div className="flex gap-2">
            <Link href="/client/engagement" className="btn-primary flex-1 text-center text-sm">
              Достижения
            </Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link href="/client/schedule" className="card flex flex-col items-center gap-2 py-6">
          <Calendar className="h-8 w-8 text-fitgo-400" />
          <span className="font-medium">Расписание</span>
        </Link>
        <MessagesHomeLink href="/client/notifications" />
        <Link href="/client/card" className="card flex flex-col items-center gap-2 py-6">
          <CreditCard className="h-8 w-8 text-fitgo-400" />
          <span className="font-medium">Карта клуба</span>
        </Link>
        <Link href="/client/products" className="card flex flex-col items-center gap-2 py-6">
          <ShoppingBag className="h-8 w-8 text-fitgo-400" />
          <span className="font-medium">Абонементы</span>
        </Link>
        <Link href="/client/engagement" className="card flex flex-col items-center gap-2 py-6">
          <Trophy className="h-8 w-8 text-fitgo-400" />
          <span className="font-medium">Достижения</span>
        </Link>
      </div>

      <div className="card">
        <div className="mb-3 flex items-center gap-2">
          <Dumbbell className="h-5 w-5 text-fitgo-400" />
          <h2 className="font-semibold">Последние визиты</h2>
        </div>
        {visits.length === 0 ? (
          <p className="text-sm text-slate-400">Пока нет посещений</p>
        ) : (
          <ul className="space-y-2">
            {visits.slice(0, 3).map((visit) => (
              <li
                key={visit.id}
                className="flex justify-between rounded-xl bg-slate-800/50 px-3 py-2 text-sm"
              >
                <span>{visit.title ?? formatDate(visit.date)}</span>
                <span className="text-slate-400">{visit.checkIn ?? '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
