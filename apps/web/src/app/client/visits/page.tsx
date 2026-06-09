'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDate } from '@/lib/utils';

interface Visit {
  id: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
  clubName: string;
}

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
              <div className="flex items-center justify-between">
                <p className="font-medium">{formatDate(visit.date)}</p>
                <p className="text-sm text-slate-400">{visit.clubName}</p>
              </div>
              <div className="mt-2 flex gap-4 text-sm text-slate-400">
                <span>Вход: {visit.checkIn ?? '—'}</span>
                <span>Выход: {visit.checkOut ?? '—'}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
