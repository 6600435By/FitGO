'use client';

import { MembershipStatus } from '@fitgo/shared-types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import {
  formatDate,
  membershipStatusColor,
  membershipStatusLabel,
} from '@/lib/utils';

interface ClientSummary {
  id: string;
  firstName: string;
  lastName: string;
  phone?: string;
  membershipName?: string;
  membershipStatus?: MembershipStatus;
  lastVisit?: string;
}

export default function TrainerClientsPage() {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    api
      .trainerDashboard(token)
      .then((data: { clients: ClientSummary[] }) => setClients(data.clients))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="text-red-400">{error}</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Мои клиенты</h2>

      {clients.length === 0 ? (
        <div className="card text-center text-slate-400">
          <p>Пока нет клиентов в вашей базе</p>
          <p className="mt-2 text-sm">
            Клиенты появятся после записи к вам на тренировку или добавления заметок
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {clients.map((client) => (
            <Link key={client.id} href={`/trainer/clients/${client.id}`} className="card block">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">
                    {client.firstName} {client.lastName}
                  </p>
                  {client.phone && (
                    <p className="text-sm text-slate-400">{client.phone}</p>
                  )}
                </div>
                {client.membershipStatus && (
                  <span
                    className={`rounded-full px-2 py-1 text-xs ${membershipStatusColor(client.membershipStatus)}`}
                  >
                    {membershipStatusLabel(client.membershipStatus)}
                  </span>
                )}
              </div>
              {client.membershipName && (
                <p className="mt-2 text-sm text-slate-300">
                  {client.membershipName}
                </p>
              )}
              {client.lastVisit && (
                <p className="mt-1 text-sm text-slate-400">
                  Последний визит: {formatDate(client.lastVisit)}
                </p>
              )}
            </Link>
          ))}
        </ul>
      )}
    </div>
  );
}
