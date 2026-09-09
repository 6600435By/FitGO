'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  CLIENT_PRIMARY_GOAL_LABELS,
  type ClientPrimaryGoal,
} from '@fitgo/shared-types';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export default function ProfileCompletePage() {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    gender: 'MALE',
    dateOfBirth: '',
  });
  const [primaryGoal, setPrimaryGoal] = useState<ClientPrimaryGoal | ''>('');
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = getToken();
    if (!token) return;

    setLoading(true);
    setError('');
    try {
      await api.updateClientProfile(token, form);
      if (primaryGoal) {
        await api.updateTrainingProfile(token, {
          primaryGoals: [primaryGoal],
        });
      }
      if (heightCm) {
        await api.updateBodyProfile(token, {
          heightCm: Number(heightCm),
        });
      }
      if (weightKg) {
        await api.addBodyLog(token, { weightKg: Number(weightKg) });
      }
      router.replace('/client');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h2 className="text-xl font-semibold">Заполните профиль</h2>
      <p className="text-sm text-slate-400">
        Минимум для записи, карты и работы с тренером. Остальное можно
        дополнить позже во вкладке «Профиль».
      </p>

      <form onSubmit={submit} className="card space-y-4">
        <div>
          <label className="mb-1 block text-sm text-slate-400">Имя</label>
          <input
            className="input"
            required
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-400">Фамилия</label>
          <input
            className="input"
            required
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-400">Телефон</label>
          <input
            className="input"
            type="tel"
            required
            placeholder="+375..."
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-400">Пол</label>
          <select
            className="input"
            value={form.gender}
            onChange={(e) => setForm({ ...form, gender: e.target.value })}
          >
            <option value="MALE">Мужской</option>
            <option value="FEMALE">Женский</option>
            <option value="OTHER">Другой</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-400">Дата рождения</label>
          <input
            className="input"
            type="date"
            required
            value={form.dateOfBirth}
            onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-400">Главная цель</label>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CLIENT_PRIMARY_GOAL_LABELS) as ClientPrimaryGoal[]).map(
              (g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setPrimaryGoal(primaryGoal === g ? '' : g)}
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    primaryGoal === g
                      ? 'bg-fitgo-500 text-white'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {CLIENT_PRIMARY_GOAL_LABELS[g]}
                </button>
              ),
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-sm text-slate-400">Рост (см)</label>
            <input
              className="input"
              type="number"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-400">Вес (кг)</label>
            <input
              className="input"
              type="number"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? 'Сохранение...' : 'Продолжить'}
        </button>
      </form>
    </div>
  );
}
