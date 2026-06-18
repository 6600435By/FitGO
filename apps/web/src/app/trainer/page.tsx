'use client';

import { SessionType, type Booking } from '@fitgo/shared-types';
import { Users, Calendar, Target, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MessagesHomeLink } from '@/components/messages-home-link';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

interface TrainerDashboard {
  trainer: { firstName: string; lastName: string };
  schedule: Array<{
    id: string;
    title: string;
    type: SessionType;
    clientId?: string;
    startAt: string;
    booked: number;
    capacity: number;
    available: boolean;
  }>;
  stats: {
    clientsCount: number;
    sessionsToday: number;
    upcomingSessions: number;
  };
}

function trainerSessionHref(slot: TrainerDashboard['schedule'][number]): string | null {
  if (slot.type !== SessionType.PERSONAL || !slot.clientId) return null;
  return `/trainer/sessions/${slot.id}?clientId=${slot.clientId}`;
}

export default function TrainerHomePage() {
  const [data, setData] = useState<TrainerDashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    api
      .trainerDashboard(token)
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="text-red-400">{error}</p>;

  if (!data) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <p className="text-sm text-slate-400">Добро пожаловать</p>
        <p className="text-2xl font-bold">
          {data.trainer.firstName} {data.trainer.lastName}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="card text-center">
          <Users className="mx-auto mb-2 h-6 w-6 text-fitgo-400" />
          <p className="stat-value">{data.stats.clientsCount}</p>
          <p className="stat-label">Клиентов</p>
        </div>
        <div className="card text-center">
          <Calendar className="mx-auto mb-2 h-6 w-6 text-fitgo-400" />
          <p className="stat-value">{data.stats.sessionsToday}</p>
          <p className="stat-label">Сегодня</p>
        </div>
        <div className="card text-center">
          <Target className="mx-auto mb-2 h-6 w-6 text-fitgo-400" />
          <p className="stat-value">{data.stats.upcomingSessions}</p>
          <p className="stat-label">Свободно</p>
        </div>
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Ближайшие занятия</h2>
          <Link href="/trainer/schedule" className="text-sm text-fitgo-400">
            Все →
          </Link>
        </div>
        <ul className="space-y-2">
          {data.schedule.length === 0 ? (
            <li className="text-sm text-slate-400">Нет предстоящих занятий</li>
          ) : (
            data.schedule.slice(0, 4).map((slot) => {
              const href = trainerSessionHref(slot);
              const inner = (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{slot.title}</p>
                    <p className="text-slate-400">{formatDateTime(slot.startAt)}</p>
                    {href && (
                      <p className="mt-0.5 text-xs text-fitgo-400">План тренировки</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-slate-400">
                    {slot.type !== SessionType.PERSONAL && (
                      <span>
                        {slot.booked}/{slot.capacity}
                      </span>
                    )}
                    {href && <ChevronRight className="h-4 w-4 text-fitgo-400" />}
                  </div>
                </>
              );

              return (
                <li key={slot.id}>
                  {href ? (
                    <Link
                      href={href}
                      className="flex items-center justify-between rounded-xl bg-slate-800/50 px-3 py-2 text-sm transition hover:bg-slate-800"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex items-center justify-between rounded-xl bg-slate-800/50 px-3 py-2 text-sm">
                      {inner}
                    </div>
                  )}
                </li>
              );
            })
          )}
        </ul>
      </div>

      <Link href="/trainer/clients" className="card block border-fitgo-500/30 bg-fitgo-500/5">
        <p className="font-medium text-fitgo-300">Mini-CRM</p>
        <p className="mt-1 text-sm text-slate-400">
          Цели, заметки, замеры и сообщения клиентам
        </p>
      </Link>

      <MessagesHomeLink href="/trainer/messages" />
    </div>
  );
}
