'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  CLIENT_PRIMARY_GOAL_LABELS,
  type ClientPrimaryGoal,
} from '@fitgo/shared-types';
import { DateField } from '@/components/ui/date-field';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const token = getToken();
    const cached = getUser();
    if (cached) {
      setForm((prev) => ({
        ...prev,
        firstName: prev.firstName || cached.firstName || '',
        lastName: prev.lastName || cached.lastName || '',
        phone: prev.phone || cached.phone || '',
      }));
    }
    if (!token) {
      setHydrated(true);
      return;
    }
    api
      .clientProfile(token)
      .then((profile) => {
        setForm((prev) => ({
          firstName: profile.firstName || prev.firstName || '',
          lastName: profile.lastName || prev.lastName || '',
          phone: profile.phone || prev.phone || '',
          gender: profile.gender || prev.gender || 'MALE',
          dateOfBirth: profile.dateOfBirth || prev.dateOfBirth || '',
        }));
        if (profile.profileCompletedAt) {
          router.replace('/client');
        }
      })
      .catch(() => {
        /* keep session prefill */
      })
      .finally(() => setHydrated(true));
  }, [router]);

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

  if (!hydrated) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

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
        <DateField
          label="Дата рождения"
          required
          value={form.dateOfBirth}
          onChange={(v) => setForm({ ...form, dateOfBirth: v })}
          max={todayIso()}
          min="1920-01-01"
          initialYear={1995}
        />

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
