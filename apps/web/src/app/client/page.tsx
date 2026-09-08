'use client';

import { MembershipStatus, SessionType, type Booking, type GamificationProfile, type Membership, type Visit } from '@fitgo/shared-types';
import { Calendar, CreditCard, ChevronRight, Dumbbell, ShoppingBag, Trophy } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MessagesHomeLink } from '@/components/messages-home-link';
import { ClientTrainerInvites } from '@/components/client/client-trainer-invites';
import { ClientClubPicker } from '@/components/client/client-club-picker';
import { MembershipFreezePanel } from '@/components/client/membership-freeze-panel';
import { useFeatures } from '@/components/features-provider';
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
  profile?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    externalId?: string;
  };
  membership: {
    name: string;
    status: MembershipStatus;
    visitsRemaining?: number;
    visitsTotal?: number;
    validFrom: string;
    validUntil: string;
    services?: { name: string; remaining?: number; total?: number; unlimited?: boolean }[];
    accountBalance?: number;
    debtAmount?: number;
    currency?: string;
    freezeAllowed?: boolean;
    freezeDaysRemaining?: number;
    freezeDaysTotal?: number;
    frozenUntil?: string;
  } | null;
  membershipSource?: '1c' | 'osmi' | 'derived' | null;
  visits: Visit[];
  accessCard?: {
    id: string;
    barcode: string;
    clientName: string;
    clubName: string;
  } | null;
  cardSource?: '1c' | 'osmi' | 'fitgo';
  club: { name: string; address?: string; slug?: string } | null;
  crmStatus?: 'LINKED' | 'PENDING_CRM' | null;
}

export default function ClientHomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
        </div>
      }
    >
      <ClientHomePageInner />
    </Suspense>
  );
}

function ClientHomePageInner() {
  const { isEnabled } = useFeatures();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<DashboardData | null>(null);
  const [upcomingBookings, setUpcomingBookings] = useState<Booking[]>([]);
  const [gamification, setGamification] = useState<GamificationProfile | null>(null);
  const [error, setError] = useState('');
  const [changingClub, setChangingClub] = useState(false);

  useEffect(() => {
    if (searchParams.get('switchClub') === '1') {
      setChangingClub(true);
    }
  }, [searchParams]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const cacheKey = 'fitgo:client-dashboard:v2';
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        setData(JSON.parse(cached) as DashboardData);
      }
    } catch {
      // ignore bad cache
    }

    let cancelled = false;
    api
      .clientDashboard(token)
      .then((next) => {
        if (cancelled) return;
        setData(next);
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(next));
        } catch {
          // quota / private mode
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    api
      .clientBookings(token)
      .then((bookings) => {
        if (cancelled) return;
        const upcoming = bookings
          .filter((b) => new Date(b.startAt) >= new Date())
          .sort((a, b) => a.startAt.localeCompare(b.startAt));
        setUpcomingBookings(upcoming.slice(0, 4));
      })
      .catch(() => {});

    api.gamification(token).then((g) => {
      if (!cancelled) setGamification(g);
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
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

  const { membership, visits, club, crmStatus, profile, accessCard, membershipSource } =
    data;
  const progress = membership
    ? membershipProgress(membership.validFrom, membership.validUntil)
    : null;
  const hasDebt = (membership?.debtAmount ?? 0) > 0;
  const hasAccountBalance = typeof membership?.accountBalance === 'number';
  const hasDebtAmount = typeof membership?.debtAmount === 'number';
  const displayName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');

  return (
    <div className="space-y-4">
      <ClientTrainerInvites />

      {displayName && club && !changingClub && (
        <div className="px-0.5">
          <p className="text-sm text-slate-400">{club.name}</p>
          <h1 className="text-xl font-semibold tracking-tight">{displayName}</h1>
        </div>
      )}

      {(!club || changingClub) && (
        <ClientClubPicker
          onJoined={(joined) => {
            setData((prev) => (prev ? { ...prev, club: joined } : prev));
            setChangingClub(false);
            router.replace('/client');
          }}
          onCancel={
            club
              ? () => {
                  setChangingClub(false);
                  router.replace('/client');
                }
              : undefined
          }
        />
      )}

      {crmStatus === 'PENDING_CRM' && club && !changingClub && (
        <div className="card space-y-2 border border-amber-500/30 bg-amber-500/5">
          <p className="font-semibold text-amber-200">Оформление в клубе</p>
          <p className="text-sm text-slate-400">
            Клиент ещё не найден в 1С. Можно смотреть расписание; запись на
            групповые и карта появятся после заведения на ресепшен.
          </p>
          <Link href="/client/schedule" className="text-sm text-fitgo-400">
            Открыть расписание →
          </Link>
        </div>
      )}

      {membership ? (
        <div className="card">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <p className="text-sm text-slate-400">Абонемент</p>
              <p className="text-xl font-semibold">{membership.name}</p>
              {membershipSource === 'derived' && (
                <p className="mt-1 text-xs text-slate-500">
                  Срок уточняется из 1С — показана оценка по последнему визиту
                </p>
              )}
            </div>
            <span
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${membershipStatusColor(membership.status)}`}
            >
              {membershipStatusLabel(membership.status)}
            </span>
          </div>

          {progress && membership.status === MembershipStatus.ACTIVE && (
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

          {(hasAccountBalance || hasDebtAmount) && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {hasAccountBalance && (
                <div className="rounded-xl bg-slate-800/50 p-3">
                  <p className="stat-label">Лицевой счёт</p>
                  <p className="stat-value text-lg">
                    {membership.accountBalance!.toFixed(2)}
                    {membership.currency ? ` ${membership.currency}` : ''}
                  </p>
                </div>
              )}
              {hasDebtAmount && (
                <div
                  className={`rounded-xl p-3 ${
                    hasDebt ? 'bg-red-500/10' : 'bg-slate-800/50'
                  }`}
                >
                  <p className="stat-label">Задолженность</p>
                  <p
                    className={`stat-value text-lg ${
                      hasDebt ? 'text-red-300' : ''
                    }`}
                  >
                    {membership.debtAmount!.toFixed(2)}
                    {membership.currency ? ` ${membership.currency}` : ''}
                  </p>
                </div>
              )}
            </div>
          )}

          {membership.validFrom && (
            <p className="mt-2 text-xs text-slate-500">
              С {formatDate(membership.validFrom)}
            </p>
          )}

          <div className="mt-3">
            <MembershipFreezePanel
              membership={membership as Membership}
              onFrozen={(next) => {
                setData((prev) => {
                  if (!prev) return prev;
                  const updated = { ...prev, membership: next };
                  try {
                    sessionStorage.setItem(
                      'fitgo:client-dashboard:v2',
                      JSON.stringify(updated),
                    );
                  } catch {
                    /* ignore */
                  }
                  return updated;
                });
              }}
            />
          </div>

          {membership.services && membership.services.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-t border-slate-800 pt-3">
              {membership.services.slice(0, 4).map((service) => (
                <li
                  key={service.name}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-slate-300">{service.name}</span>
                  <span className="text-slate-400">
                    {service.unlimited
                      ? '∞'
                      : service.remaining !== undefined
                        ? service.total
                          ? `${service.remaining}/${service.total}`
                          : String(service.remaining)
                        : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Link href="/client/card" className="mt-3 inline-block text-sm text-fitgo-400">
            Карта и услуги →
          </Link>
        </div>
      ) : (
        <div className="card text-center">
          <p className="text-slate-400">
            {crmStatus === 'PENDING_CRM'
              ? 'Абонемент появится после оформления в клубе'
              : club
                ? 'Абонемент не найден'
                : 'Клуб не подключён — персональные тренировки доступны без абонемента'}
          </p>
          {club && crmStatus !== 'PENDING_CRM' && isEnabled('membership_shop') && (
            <Link href="/client/products" className="btn-primary mt-4 inline-block">
              Купить абонемент
            </Link>
          )}
        </div>
      )}

      {accessCard && isEnabled('club_card') && (
        <Link
          href="/client/card"
          className="card flex items-center justify-between gap-3 transition hover:bg-slate-800/40"
        >
          <div className="min-w-0">
            <p className="text-sm text-slate-400">Карта клуба</p>
            <p className="truncate font-medium">{accessCard.clientName}</p>
            <p className="font-mono text-sm text-fitgo-400">
              ••• {accessCard.barcode.slice(-4)}
            </p>
          </div>
          <CreditCard className="h-8 w-8 shrink-0 text-fitgo-400" />
        </Link>
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

      {gamification?.activated && isEnabled('engagement') && (
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
        {isEnabled('group_classes') && (
          <Link href="/client/schedule" className="card flex flex-col items-center gap-2 py-6">
            <Calendar className="h-8 w-8 text-fitgo-400" />
            <span className="font-medium">Расписание</span>
          </Link>
        )}
        {isEnabled('messaging') && (
          <MessagesHomeLink href="/client/notifications" />
        )}
        {isEnabled('club_card') && (
          <Link href="/client/card" className="card flex flex-col items-center gap-2 py-6">
            <CreditCard className="h-8 w-8 text-fitgo-400" />
            <span className="font-medium">Карта клуба</span>
          </Link>
        )}
        {isEnabled('membership_shop') && (
          <Link href="/client/products" className="card flex flex-col items-center gap-2 py-6">
            <ShoppingBag className="h-8 w-8 text-fitgo-400" />
            <span className="font-medium">Абонементы</span>
          </Link>
        )}
        {isEnabled('engagement') && (
          <Link href="/client/engagement" className="card flex flex-col items-center gap-2 py-6">
            <Trophy className="h-8 w-8 text-fitgo-400" />
            <span className="font-medium">Достижения</span>
          </Link>
        )}
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Dumbbell className="h-5 w-5 text-fitgo-400" />
            <h2 className="font-semibold">Последние визиты</h2>
          </div>
          {isEnabled('club_card') && (
            <Link href="/client/visits" className="text-sm text-fitgo-400">
              Все →
            </Link>
          )}
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
