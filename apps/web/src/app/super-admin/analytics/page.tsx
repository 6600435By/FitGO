'use client';

import type { SuperAdminAnalytics } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export default function SuperAdminAnalyticsPage() {
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');
  const [data, setData] = useState<SuperAdminAnalytics | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api.superAdminAnalytics(token, period)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [period]);

  if (error) return <p className="text-red-400">{error}</p>;

  if (!data) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  const { kpis } = data;
  const visitDelta = kpis.visitsPrev
    ? Math.round(((kpis.visits - kpis.visitsPrev) / kpis.visitsPrev) * 100)
    : 0;
  const revenueDelta = kpis.revenuePrev
    ? Math.round(((kpis.revenue - kpis.revenuePrev) / kpis.revenuePrev) * 100)
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['7d', '30d', '90d'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`rounded-full px-3 py-1 text-sm ${period === p ? 'bg-fitgo-500 text-white' : 'bg-slate-800'}`}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card">
          <p className="stat-value">{kpis.visits}</p>
          <p className="stat-label">Визиты ({visitDelta >= 0 ? '+' : ''}{visitDelta}%)</p>
        </div>
        <div className="card">
          <p className="stat-value">{kpis.activeMemberships}</p>
          <p className="stat-label">Активных абонементов</p>
        </div>
        <div className="card">
          <p className="stat-value">{kpis.expiringSoon}</p>
          <p className="stat-label">Истекают за 7 дн.</p>
        </div>
        <div className="card">
          <p className="stat-value">{kpis.revenue.toLocaleString('ru-RU')}</p>
          <p className="stat-label">Выручка ({revenueDelta >= 0 ? '+' : ''}{revenueDelta}%)</p>
        </div>
        <div className="card">
          <p className="stat-value">{kpis.personalSessionsCompleted}</p>
          <p className="stat-label">PT проведено</p>
        </div>
        <div className="card">
          <p className="stat-value">{kpis.adminTasksDoneRate}%</p>
          <p className="stat-label">Задач выполнено</p>
        </div>
      </div>

      <div className="card">
        <h3 className="mb-3 font-semibold">Рейтинг тренеров</h3>
        {data.trainerRankings.length === 0 ? (
          <p className="text-sm text-slate-400">Нет данных</p>
        ) : (
          <ul className="space-y-2">
            {data.trainerRankings.map((t, i) => (
              <li key={t.trainerId} className="flex justify-between text-sm">
                <span>{i + 1}. {t.name}</span>
                <span className="text-slate-400">score {t.score} · PT {t.completedPt}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h3 className="mb-3 font-semibold">Групповые направления</h3>
        <ul className="space-y-2">
          {data.groupDirectionLoad.map((g) => (
            <li key={g.title} className="text-sm">
              <div className="flex justify-between">
                <span>{g.title}</span>
                <span className="text-slate-400">{g.bookings} записей</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-slate-800">
                <div className="h-2 rounded-full bg-fitgo-500" style={{ width: `${g.loadPercent}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h3 className="mb-3 font-semibold">Рекомендации</h3>
        {data.insights.length === 0 ? (
          <p className="text-sm text-slate-400">Всё в норме</p>
        ) : (
          <ul className="space-y-3">
            {data.insights.map((insight, i) => (
              <li key={i} className="rounded-xl bg-slate-800/50 p-3 text-sm">
                <p className="font-medium">{insight.title}</p>
                <p className="text-slate-400">{insight.body}</p>
                {insight.action && <p className="mt-1 text-fitgo-400">{insight.action}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card text-sm text-slate-400">
        Интеграция: {data.integrationHealth?.provider ?? 'mock'}
        {data.integrationHealth?.clubExternalId && ` · ${data.integrationHealth.clubExternalId}`}
      </div>
    </div>
  );
}
