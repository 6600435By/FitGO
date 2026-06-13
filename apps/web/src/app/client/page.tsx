'use client';

import { MembershipStatus, type Visit } from '@fitgo/shared-types';
import { Calendar, CreditCard, Dumbbell, ShoppingBag, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import {
  formatDate,
  formatDateTime,
  membershipProgress,
  membershipStatusColor,
  membershipStatusLabel,
} from '@/lib/utils';

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
  const [nextBooking, setNextBooking] = useState<{
    title: string;
    startAt: string;
  } | null>(null);
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
        if (upcoming[0]) {
          setNextBooking({
            title: upcoming[0].title,
            startAt: upcoming[0].startAt,
          });
        }
      })
      .catch(() => {});
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
      {club && (
        <div className="card">
          <p className="text-sm text-slate-400">Ваш клуб</p>
          <p className="text-xl font-semibold">{club.name}</p>
          {club.address && (
            <p className="mt-1 text-sm text-slate-400">{club.address}</p>
          )}
        </div>
      )}

      {nextBooking ? (
        <Link href="/client/bookings" className="card block border-fitgo-500/30 bg-fitgo-500/5">
          <p className="text-sm text-fitgo-400">Ближайшая запись</p>
          <p className="font-semibold">{nextBooking.title}</p>
          <p className="text-sm text-slate-400">
            {formatDateTime(nextBooking.startAt)}
          </p>
        </Link>
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
          <p className="text-slate-400">Абонемент не найден</p>
          <Link href="/client/products" className="btn-primary mt-4 inline-block">
            Купить абонемент
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link href="/client/schedule" className="card flex flex-col items-center gap-2 py-6">
          <Calendar className="h-8 w-8 text-fitgo-400" />
          <span className="font-medium">Расписание</span>
        </Link>
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
