'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDate } from '@/lib/utils';

interface DailyReport {
  id: string;
  date: string;
  revenue: number;
  problems?: string | null;
  ideas?: string | null;
}

export default function AdminReportsPage() {
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [revenue, setRevenue] = useState('');
  const [problems, setProblems] = useState('');
  const [ideas, setIdeas] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const loadReports = () => {
    const token = getToken();
    if (!token) return;

    api
      .adminReports(token)
      .then((data: { recentReports: DailyReport[] }) =>
        setReports(data.recentReports ?? []),
      );
  };

  useEffect(() => {
    loadReports();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const token = getToken();
    if (!token) return;

    setLoading(true);
    setMessage('');

    try {
      await api.createDailyReport(token, {
        date,
        revenue: parseFloat(revenue),
        problems: problems || undefined,
        ideas: ideas || undefined,
      });
      setMessage('Отчёт сохранён');
      setRevenue('');
      setProblems('');
      setIdeas('');
      loadReports();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Дневная статистика</h2>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <div>
          <label className="mb-2 block text-sm text-slate-400">Дата</label>
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="mb-2 block text-sm text-slate-400">Выручка (BYN)</label>
          <input
            type="number"
            className="input"
            value={revenue}
            onChange={(e) => setRevenue(e.target.value)}
            min="0"
            step="0.01"
            required
          />
        </div>
        <div>
          <label className="mb-2 block text-sm text-slate-400">Проблемы</label>
          <textarea
            className="input min-h-[80px]"
            value={problems}
            onChange={(e) => setProblems(e.target.value)}
            placeholder="Что пошло не так сегодня?"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm text-slate-400">Идеи для улучшения</label>
          <textarea
            className="input min-h-[80px]"
            value={ideas}
            onChange={(e) => setIdeas(e.target.value)}
            placeholder="Что можно улучшить?"
          />
        </div>

        {message && (
          <p className="text-sm text-fitgo-400">{message}</p>
        )}

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? 'Сохранение...' : 'Сохранить отчёт'}
        </button>
      </form>

      {reports.length > 0 && (
        <div className="card">
          <h3 className="mb-3 font-semibold">Недавние отчёты</h3>
          <ul className="space-y-3">
            {reports.map((report) => (
              <li
                key={report.id}
                className="rounded-xl bg-slate-800/50 px-3 py-2 text-sm"
              >
                <div className="flex justify-between">
                  <span>{formatDate(report.date)}</span>
                  <span className="font-medium">
                    {report.revenue.toLocaleString('ru-RU')} BYN
                  </span>
                </div>
                {report.problems && (
                  <p className="mt-1 text-slate-400">Проблемы: {report.problems}</p>
                )}
                {report.ideas && (
                  <p className="mt-1 text-slate-400">Идеи: {report.ideas}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
