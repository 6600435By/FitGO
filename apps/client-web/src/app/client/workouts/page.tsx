'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

const WORKOUT_TYPES = [
  { value: 'RUNNING', label: 'Бег' },
  { value: 'CYCLING', label: 'Велосипед' },
  { value: 'STRENGTH', label: 'Силовая' },
  { value: 'YOGA', label: 'Йога' },
  { value: 'OTHER', label: 'Другое' },
];

export default function ClientWorkoutsPage() {
  const [workouts, setWorkouts] = useState<Array<{
    id: string;
    type: string;
    startedAt: string;
    durationMin: number;
    notes?: string;
  }>>([]);
  const [form, setForm] = useState({
    type: 'RUNNING',
    startedAt: new Date().toISOString().slice(0, 16),
    durationMin: '30',
    notes: '',
  });
  const [msg, setMsg] = useState('');

  const load = () => {
    const token = getToken();
    if (!token) return;
    api.getWorkouts(token).then(setWorkouts).catch(() => {});
  };

  useEffect(load, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = getToken();
    if (!token) return;
    try {
      await api.createWorkout(token, {
        type: form.type,
        startedAt: new Date(form.startedAt).toISOString(),
        durationMin: Number(form.durationMin),
        notes: form.notes || undefined,
      });
      setMsg('Тренировка добавлена (+15 XP)');
      load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Ошибка');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Тренировки вне клуба</h2>
        <Link href="/client/engagement" className="text-sm text-fitgo-400">
          ← Достижения
        </Link>
      </div>

      <form onSubmit={submit} className="card space-y-3">
        <select
          className="input"
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value })}
        >
          {WORKOUT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <input
          className="input"
          type="datetime-local"
          value={form.startedAt}
          onChange={(e) => setForm({ ...form, startedAt: e.target.value })}
        />
        <input
          className="input"
          type="number"
          placeholder="Длительность (мин)"
          value={form.durationMin}
          onChange={(e) => setForm({ ...form, durationMin: e.target.value })}
        />
        <input
          className="input"
          placeholder="Заметки"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
        {msg && <p className="text-sm text-fitgo-400">{msg}</p>}
        <button type="submit" className="btn-primary w-full">
          Добавить тренировку
        </button>
      </form>

      <div className="card">
        <h3 className="mb-3 font-semibold">История</h3>
        {workouts.length === 0 ? (
          <p className="text-sm text-slate-400">Пока нет записей</p>
        ) : (
          <ul className="space-y-2">
            {workouts.map((w) => (
              <li key={w.id} className="rounded-xl bg-slate-800/50 px-3 py-2 text-sm">
                <div className="flex justify-between">
                  <span>{WORKOUT_TYPES.find((t) => t.value === w.type)?.label ?? w.type}</span>
                  <span className="text-slate-400">{w.durationMin} мин</span>
                </div>
                <p className="text-xs text-slate-500">
                  {new Date(w.startedAt).toLocaleString('ru-RU')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
