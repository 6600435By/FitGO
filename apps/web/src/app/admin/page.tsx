'use client';

import { AlertTriangle, Bell, TrendingUp, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDate } from '@/lib/utils';

interface AdminDashboard {
  club: { name: string; address?: string } | null;
  stats: {
    activeMemberships: number;
    visitsToday: number;
    revenueToday: number;
    expiringSoon: number;
    bookingsToday: number;
  };
  expiringClients: Array<{
    name: string;
    membership: string;
    validUntil: string;
    daysLeft: number;
  }>;
}

export default function AdminHomePage() {
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    api
      .adminDashboard(token)
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
      {data.club && (
        <div className="card">
          <p className="text-sm text-slate-400">Клуб</p>
          <p className="text-xl font-semibold">{data.club.name}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="card">
          <Users className="mb-2 h-5 w-5 text-fitgo-400" />
          <p className="stat-value">{data.stats.activeMemberships}</p>
          <p className="stat-label">Активных абонементов</p>
        </div>
        <div className="card">
          <TrendingUp className="mb-2 h-5 w-5 text-fitgo-400" />
          <p className="stat-value">{data.stats.visitsToday}</p>
          <p className="stat-label">Визитов сегодня</p>
        </div>
        <div className="card">
          <p className="stat-value">{data.stats.revenueToday.toLocaleString('ru-RU')} BYN</p>
          <p className="stat-label">Выручка сегодня</p>
        </div>
        <div className="card">
          <Bell className="mb-2 h-5 w-5 text-amber-400" />
          <p className="stat-value">{data.stats.expiringSoon}</p>
          <p className="stat-label">Истекают скоро</p>
        </div>
      </div>

      <div className="card">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-400" />
          <h2 className="font-semibold">Напоминания об абонементах</h2>
        </div>
        <ul className="space-y-2">
          {data.expiringClients.map((client, i) => (
            <li
              key={i}
              className="flex items-center justify-between rounded-xl bg-slate-800/50 px-3 py-2 text-sm"
            >
              <div>
                <p className="font-medium">{client.name}</p>
                <p className="text-slate-400">{client.membership}</p>
              </div>
              <div className="text-right">
                <p className="text-amber-400">{client.daysLeft} дн.</p>
                <p className="text-slate-500">{formatDate(client.validUntil)}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/admin/at-risk" className="btn-secondary text-center">
          Клиенты в зоне риска
        </Link>
        <Link href="/admin/settings" className="btn-secondary text-center">
          Брендинг клуба
        </Link>
        <Link href="/admin/clubs" className="btn-secondary text-center">
          Сеть клубов
        </Link>
        <Link href="/admin/reports" className="btn-primary text-center">
          Дневной отчёт
        </Link>
      </div>
    </div>
  );
}
