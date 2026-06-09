'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

interface ScheduleSlot {
  id: string;
  title: string;
  type: string;
  startAt: string;
  endAt: string;
  booked: number;
  capacity: number;
  available: boolean;
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
          {schedule.map((slot) => (
            <li key={slot.id} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">{slot.title}</p>
                  <p className="text-sm text-slate-400">
                    {slot.type === 'PERSONAL' ? 'Персональная' : 'Групповая'}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-xs ${
                    slot.available
                      ? 'bg-emerald-400/10 text-emerald-400'
                      : 'bg-red-400/10 text-red-400'
                  }`}
                >
                  {slot.available ? 'Есть места' : 'Заполнено'}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-400">
                {formatDateTime(slot.startAt)} — {formatDateTime(slot.endAt)}
              </p>
              <p className="mt-1 text-sm">
                Записано: {slot.booked} / {slot.capacity}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
