'use client';

import { SessionType, type ScheduleSlot } from '@fitgo/shared-types';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

function trainerSessionHref(slot: ScheduleSlot): string | null {
  if (slot.type !== SessionType.PERSONAL || !slot.clientId) return null;
  return `/trainer/sessions/${slot.id}?clientId=${slot.clientId}`;
}

export default function TrainerSchedulePage() {
  const [schedule, setSchedule] = useState<ScheduleSlot[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    api
      .trainerDashboard(token)
      .then((data: { schedule: ScheduleSlot[] }) => setSchedule(data.schedule))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="text-red-400">{error}</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Моё расписание</h2>

      {schedule.length === 0 ? (
        <div className="card text-center text-slate-400">
          Нет запланированных занятий
        </div>
      ) : (
        <ul className="space-y-3">
          {schedule.map((slot) => {
            const href = trainerSessionHref(slot);
            const card = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{slot.title}</p>
                    <p className="text-sm text-slate-400">
                      {slot.type === SessionType.PERSONAL ? 'Персональная' : 'Групповая'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {slot.type !== SessionType.PERSONAL && (
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${
                          slot.available
                            ? 'bg-emerald-400/10 text-emerald-400'
                            : 'bg-red-400/10 text-red-400'
                        }`}
                      >
                        {slot.available ? 'Есть места' : 'Заполнено'}
                      </span>
                    )}
                    {href && <ChevronRight className="h-5 w-5 text-fitgo-400" />}
                  </div>
                </div>
                <p className="mt-2 text-sm text-slate-400">
                  {formatDateTime(slot.startAt)} — {formatDateTime(slot.endAt)}
                </p>
                {slot.type !== SessionType.PERSONAL && (
                  <p className="mt-1 text-sm">
                    Записано: {slot.booked} / {slot.capacity}
                  </p>
                )}
                {href && (
                  <p className="mt-2 text-sm font-medium text-fitgo-400">
                    Открыть план тренировки
                  </p>
                )}
              </>
            );

            return (
              <li key={slot.id}>
                {href ? (
                  <Link href={href} className="card block transition hover:border-fitgo-500/30">
                    {card}
                  </Link>
                ) : (
                  <div className="card">{card}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
