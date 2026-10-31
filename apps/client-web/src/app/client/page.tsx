'use client';

import {
  MembershipStatus,
  SessionType,
  classifyVisitKind,
  type Booking,
  type GamificationProfile,
  type Membership,
  type ProductModuleKey,
  type Visit,
  type VisitKind,
} from '@fitgo/shared-types';
import {
  Calendar,
  ChevronRight,
  CreditCard,
  Dumbbell,
  Flower2,
  ShoppingBag,
  Sparkles,
  Trophy,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { ClientTrainerInvites } from '@/components/client/client-trainer-invites';
import { HomeMembershipCard } from '@/components/client/home-membership-card';
import { WeekActivity } from '@/components/client/week-activity';
import { Avatar } from '@/components/forma/avatar';
import { Countdown } from '@/components/forma/countdown';
import { SkeletonCard } from '@/components/forma/skeleton';
import { useFeatures } from '@/components/features-provider';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { ensureFormaClub } from '@/lib/ensure-forma-club';
import {
  formatDateTime,
  formatShortVisitDate,
  visitHeadline,
} from '@/lib/utils';

function membershipServiceAction(
  serviceName: string,
  isEnabled: (key: ProductModuleKey) => boolean,
): { href: string } | null {
  const kind: VisitKind = classifyVisitKind({
    title: serviceName,
    basisType: 'service',
  });
  if (kind === 'SPA_MASSAGE' || kind === 'SPA_BODYCOMP') {
    if (!isEnabled('spa_booking')) return null;
    return {
      href: `/client/schedule/spa?service=${encodeURIComponent(serviceName)}`,
    };
  }
  if (kind === 'GROUP') {
    if (!isEnabled('group_classes')) return null;
    return { href: '/client/schedule' };
  }
  if (kind === 'PT') {
    return { href: '/client/schedule/personal' };
  }
  return null;
}

function clientWorkoutHref(booking: Booking): string | null {
  if (booking.source === 'fitgo' && booking.type === SessionType.PERSONAL) {
    return `/client/personal-bookings/${booking.sessionId}`;
  }
  return null;
}

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
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
    services?: {
      name: string;
      remaining?: number;
      total?: number;
      unlimited?: boolean;
    }[];
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
        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      }
    >
      <ClientHomePageInner />
    </Suspense>
  );
}

function ClientHomePageInner() {
  const { isEnabled } = useFeatures();
  const [data, setData] = useState<DashboardData | null>(null);
  const [upcomingBookings, setUpcomingBookings] = useState<Booking[]>([]);
  const [gamification, setGamification] = useState<GamificationProfile | null>(
    null,
  );
  const [error, setError] = useState('');
  const [joiningClub, setJoiningClub] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const cacheKey = 'fitgo:client-dashboard:v2';
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) setData(JSON.parse(cached) as DashboardData);
    } catch {
      /* ignore */
    }

    let cancelled = false;

    const loadDashboard = () =>
      api.clientDashboard(token).then((next) => {
        if (cancelled) return next;
        setData(next);
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });

    loadDashboard()
      .then(async (next) => {
        if (cancelled || next.club) return;
        setJoiningClub(true);
        const joined = await ensureFormaClub(token);
        if (cancelled) return;
        setJoiningClub(false);
        if (joined) {
          await loadDashboard();
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
          .filter(
            (b) =>
              b.lifecycle !== 'CANCELLED' && new Date(b.startAt) >= new Date(),
          )
          .sort((a, b) => a.startAt.localeCompare(b.startAt));
        setUpcomingBookings(upcoming.slice(0, 4));
      })
      .catch(() => {});

    api
      .gamification(token)
      .then((g) => {
        if (!cancelled) setGamification(g);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="text-rose-400">{error}</p>;
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <SkeletonCard lines={2} />
        <SkeletonCard />
      </div>
    );
  }

  const { membership, visits, club, crmStatus, membershipSource, profile } =
    data;
  const firstName = profile?.firstName?.trim();
  const nextBooking = upcomingBookings[0] ?? null;

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-3 pt-1">
        <div>
          <p className="text-sm text-zinc-500">{timeGreeting()}</p>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            {firstName || 'Forma'}
          </h1>
        </div>
        {joiningClub ? (
          <span className="text-xs text-zinc-500">Подключаем клуб…</span>
        ) : null}
      </header>

      <ClientTrainerInvites />

      {crmStatus === 'PENDING_CRM' && club && (
        <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="font-display font-semibold text-amber-100">
            Оформление в клубе
          </p>
          <p className="mt-1 text-sm text-amber-100/70">
            Карта и запись на групповые появятся после оформления на ресепшен.
            Расписание уже можно смотреть.
          </p>
          <Link
            href="/client/schedule"
            className="mt-2 inline-block text-sm font-semibold text-forma-400"
          >
            Открыть расписание →
          </Link>
        </div>
      )}

      {isEnabled('club_card') && (
        <Link
          href="/client/card"
          className="flex items-center gap-3 rounded-3xl border border-white/10 bg-ink-elevated/90 p-3.5 shadow-forma-card transition active:scale-[0.99] touch-manipulation"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-forma-500 text-ink shadow-forma-glow">
            <CreditCard className="h-6 w-6" strokeWidth={2.25} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">
              Пропуск в клуб
            </p>
            <p className="font-display text-lg font-bold text-white">Моя карта</p>
          </div>
          <ChevronRight className="h-5 w-5 text-zinc-500" />
        </Link>
      )}

      {membership ? (
        <HomeMembershipCard
          membership={membership as Membership}
          membershipSource={membershipSource}
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
          serviceActions={
            membership.services && membership.services.length > 0 ? (
              <ul className="space-y-1.5 border-t border-ink/10 pt-3">
                {membership.services.slice(0, 8).map((service) => {
                  const hasQuota =
                    service.unlimited || (service.remaining ?? 0) > 0;
                  const action = hasQuota
                    ? membershipServiceAction(service.name, isEnabled)
                    : null;
                  return (
                    <li
                      key={service.name}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="text-ink/80">{service.name}</span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums text-ink/55">
                          {service.unlimited
                            ? '∞'
                            : service.remaining !== undefined
                              ? service.total
                                ? `${service.remaining}/${service.total}`
                                : String(service.remaining)
                              : '—'}
                        </span>
                        {action ? (
                          <Link
                            href={action.href}
                            className="rounded-lg bg-ink/15 px-2 py-1 text-xs font-semibold text-ink"
                          >
                            Использовать
                          </Link>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null
          }
        />
      ) : (
        <div className="card text-center">
          <p className="text-zinc-400">
            {crmStatus === 'PENDING_CRM'
              ? 'Абонемент появится после оформления в клубе'
              : club
                ? 'Абонемент не найден'
                : 'Абонемент появится после оформления в клубе'}
          </p>
          {club &&
            crmStatus !== 'PENDING_CRM' &&
            isEnabled('membership_shop') && (
              <Link href="/client/products" className="btn-primary mt-4 inline-block">
                Купить абонемент
              </Link>
            )}
        </div>
      )}

      {nextBooking ? (
        <NextBookingCard booking={nextBooking} />
      ) : (
        <Link
          href="/client/schedule"
          className="card block space-y-3 text-center transition hover:border-forma-500/30"
        >
          <p className="text-zinc-400">Нет предстоящих записей</p>
          <span className="btn-primary inline-flex">Записаться</span>
        </Link>
      )}

      {upcomingBookings.length > 1 ? (
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-display text-base font-semibold">Ещё записи</p>
            <Link href="/client/bookings" className="text-sm text-forma-400">
              Все →
            </Link>
          </div>
          <ul className="space-y-2">
            {upcomingBookings.slice(1).map((booking) => (
              <li
                key={booking.id}
                className="rounded-2xl bg-ink-raised/80 px-3 py-2.5"
              >
                <p className="font-medium text-white">{booking.title}</p>
                <p className="text-sm text-zinc-500">
                  {formatDateTime(booking.startAt)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5">
        {isEnabled('group_classes') && (
          <QuickAction
            href="/client/schedule"
            icon={Calendar}
            label="Расписание"
          />
        )}
        <QuickAction
          href="/client/schedule/personal"
          icon={UserRound}
          label="Персональная"
        />
        {isEnabled('spa_booking') && (
          <QuickAction
            href="/client/schedule/spa"
            icon={Flower2}
            label="SPA"
          />
        )}
        {isEnabled('club_card') && (
          <QuickAction href="/client/card" icon={CreditCard} label="Пропуск" />
        )}
        {isEnabled('membership_shop') && (
          <QuickAction
            href="/client/products"
            icon={ShoppingBag}
            label="Абонементы"
          />
        )}
        {isEnabled('engagement') && (
          <QuickAction
            href="/client/engagement"
            icon={Trophy}
            label="Достижения"
          />
        )}
      </div>

      {isEnabled('club_card') && visits.length > 0 ? (
        <WeekActivity visits={visits} />
      ) : null}

      {gamification?.activated && isEnabled('engagement') && (
        <Link
          href="/client/engagement"
          className="card flex items-center gap-3 transition hover:border-forma-500/30"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-forma-500/15 text-forma-400">
            <Trophy className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display font-semibold text-white">
              {gamification.league?.tierLabel ?? 'Бронза'}
            </p>
            {gamification.league?.myRank ? (
              <p className="text-sm text-zinc-500">
                #{gamification.league.myRank} в группе
              </p>
            ) : (
              <p className="text-sm text-zinc-500">Ваша лига</p>
            )}
            {gamification.decayWarning ? (
              <p className="mt-1 text-xs text-amber-300">
                {gamification.decayWarning.message}
              </p>
            ) : null}
          </div>
          <ChevronRight className="h-5 w-5 text-zinc-500" />
        </Link>
      )}

      <div className="card">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Dumbbell className="h-5 w-5 text-forma-400" />
            <h2 className="font-display font-semibold">Последние визиты</h2>
          </div>
          {isEnabled('club_card') && (
            <Link href="/client/visits" className="text-sm text-forma-400">
              Все →
            </Link>
          )}
        </div>
        {visits.length === 0 ? (
          <p className="text-sm text-zinc-500">Пока нет посещений</p>
        ) : (
          <ul className="relative space-y-0 pl-3">
            <span className="absolute bottom-2 left-[7px] top-2 w-px bg-white/10" />
            {visits.slice(0, 4).map((visit) => (
              <li
                key={visit.id}
                className="relative flex items-center justify-between gap-3 py-2.5 pl-4"
              >
                <span className="absolute left-0 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-forma-500" />
                <span className="min-w-0 truncate text-sm text-zinc-200">
                  {visitHeadline(visit)}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                  {formatShortVisitDate(visit.date)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function QuickAction({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof Calendar;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="card flex flex-col items-start gap-3 py-4 transition hover:border-forma-500/35 active:scale-[0.99] touch-manipulation"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-forma-500/15 text-forma-400">
        <Icon className="h-5 w-5" />
      </span>
      <span className="font-medium text-white">{label}</span>
    </Link>
  );
}

function NextBookingCard({ booking }: { booking: Booking }) {
  const workoutHref = clientWorkoutHref(booking);
  const inner = (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-forma-400" />
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-forma-400">
            Следующая тренировка
          </p>
        </div>
        <Countdown to={booking.startAt} compact />
      </div>
      <div className="flex items-start gap-3">
        <Avatar
          name={booking.trainerName || booking.title}
          size="lg"
          className="rounded-2xl"
        />
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-bold leading-tight text-white">
            {booking.title}
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            {formatDateTime(booking.startAt)}
          </p>
          {booking.trainerName ? (
            <p className="text-sm text-zinc-500">{booking.trainerName}</p>
          ) : null}
        </div>
        <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-zinc-500" />
      </div>
      {workoutHref ? (
        <p className="mt-3 text-xs font-medium text-forma-400">
          Открыть план тренировки
        </p>
      ) : null}
    </>
  );

  if (workoutHref) {
    return (
      <Link
        href={workoutHref}
        className="card block border-forma-500/25 bg-gradient-to-br from-forma-500/10 to-transparent transition active:scale-[0.99]"
      >
        {inner}
      </Link>
    );
  }

  return (
    <Link
      href="/client/bookings"
      className="card block border-forma-500/25 bg-gradient-to-br from-forma-500/10 to-transparent transition active:scale-[0.99]"
    >
      {inner}
    </Link>
  );
}
