'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

interface ClubSummary {
  id: string;
  name: string;
  slug: string;
  address?: string;
  currency: string;
  primaryColor: string;
}

export default function AdminClubsPage() {
  const [clubs, setClubs] = useState<ClubSummary[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api
      .adminClubs(token)
      .then(setClubs)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="text-red-400">{error}</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Сеть клубов</h2>
      <p className="text-sm text-slate-400">
        Обзор всех клубов в сети (multi-club)
      </p>

      <ul className="space-y-3">
        {clubs.map((club) => (
          <li key={club.id} className="card">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold">{club.name}</p>
                {club.address && (
                  <p className="text-sm text-slate-400">{club.address}</p>
                )}
              </div>
              <span
                className="h-4 w-4 rounded-full"
                style={{ backgroundColor: club.primaryColor }}
              />
            </div>
            <p className="mt-2 text-sm text-slate-400">
              {club.slug} · {club.currency}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
