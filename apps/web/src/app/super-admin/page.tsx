'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export default function SuperAdminHomePage() {
  const [summary, setSummary] = useState<{
    staffCount: number;
    openTasks: number;
    visits: number;
    revenue: number;
  } | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    Promise.all([
      api.superAdminStaff(token),
      api.superAdminTasks(token),
      api.superAdminAnalytics(token, '30d'),
    ]).then(([staff, tasks, analytics]) => {
      setSummary({
        staffCount: staff.length,
        openTasks: tasks.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED').length,
        visits: analytics.kpis.visits,
        revenue: analytics.kpis.revenue,
      });
    });
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Управление командой клуба, правами администраторов и аналитикой.
      </p>

      {summary && (
        <div className="grid grid-cols-2 gap-3">
          <div className="card">
            <p className="stat-value">{summary.staffCount}</p>
            <p className="stat-label">Сотрудников</p>
          </div>
          <div className="card">
            <p className="stat-value">{summary.openTasks}</p>
            <p className="stat-label">Открытых задач</p>
          </div>
          <div className="card">
            <p className="stat-value">{summary.visits}</p>
            <p className="stat-label">Визитов (30 дн.)</p>
          </div>
          <div className="card">
            <p className="stat-value">{summary.revenue.toLocaleString('ru-RU')}</p>
            <p className="stat-label">Выручка (30 дн.)</p>
          </div>
        </div>
      )}

      <div className="grid gap-3">
        <Link href="/super-admin/staff" className="card block">
          <p className="font-medium">Staff</p>
          <p className="text-sm text-slate-400">Добавить админов и тренеров</p>
        </Link>
        <Link href="/super-admin/analytics" className="card block">
          <p className="font-medium">Аналитика</p>
          <p className="text-sm text-slate-400">KPI и рекомендации роста</p>
        </Link>
      </div>
    </div>
  );
}
