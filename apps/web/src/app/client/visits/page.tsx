'use client';

import type { Visit } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDate, sessionTypeLabel } from '@/lib/utils';

export default function ClientVisitsPage() {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    api
      .clientDashboard(token)
      .then((data: { visits: Visit[] }) => setVisits(data.visits))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="text-red-400">{error}</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">История посещений</h2>

      {visits.length === 0 ? (
        <div className="card text-center text-slate-400">
          Нет записей о посещениях
        </div>
      ) : (
        <ul className="space-y-3">
          {visits.map((visit) => (
            <li key={visit.id} className="card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  {visit.title ? (
                    <p className="font-medium">{visit.title}</p>
                  ) : (
                    <p className="font-medium">{formatDate(visit.date)}</p>
                  )}
                  {visit.title && (
                    <p className="text-sm text-slate-400">
                      {formatDate(visit.date)}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <p className="text-sm text-slate-400">{visit.clubName}</p>
                  {visit.sessionType && (
                    <span className="rounded-full bg-slate-800 px-2 py-1 text-xs">
                      {sessionTypeLabel(visit.sessionType)}
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-2 flex gap-4 text-sm text-slate-400">
                <span>Начало: {visit.checkIn ?? '—'}</span>
                <span>Конец: {visit.checkOut ?? '—'}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
