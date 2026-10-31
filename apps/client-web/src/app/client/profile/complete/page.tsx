'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  CLIENT_PRIMARY_GOAL_LABELS,
  type ClientPrimaryGoal,
} from '@fitgo/shared-types';
import { AuthError, FieldLabel } from '@/components/forma/auth-shell';
import { Button } from '@/components/forma/button';
import { Chip } from '@/components/forma/chip';
import { PageHeader } from '@/components/forma/page-header';
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
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-forma-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Заполните профиль"
        subtitle="Минимум для записи, карты и работы с тренером. Остальное — позже в «Профиле»."
      />

      <form onSubmit={submit} className="card space-y-4">
        <div>
          <FieldLabel>Имя</FieldLabel>
          <input
            className="input"
            required
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          />
        </div>
        <div>
          <FieldLabel>Фамилия</FieldLabel>
          <input
            className="input"
            required
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
        </div>
        <div>
          <FieldLabel>Телефон</FieldLabel>
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
          <FieldLabel>Пол</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['MALE', 'Мужской'],
                ['FEMALE', 'Женский'],
                ['OTHER', 'Другой'],
              ] as const
            ).map(([value, label]) => (
              <Chip
                key={value}
                active={form.gender === value}
                onClick={() => setForm({ ...form, gender: value })}
              >
                {label}
              </Chip>
            ))}
          </div>
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
          <FieldLabel>Главная цель</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CLIENT_PRIMARY_GOAL_LABELS) as ClientPrimaryGoal[]).map(
              (g) => (
                <Chip
                  key={g}
                  active={primaryGoal === g}
                  onClick={() => setPrimaryGoal(primaryGoal === g ? '' : g)}
                >
                  {CLIENT_PRIMARY_GOAL_LABELS[g]}
                </Chip>
              ),
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Рост (см)</FieldLabel>
            <input
              className="input"
              type="number"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>Вес (кг)</FieldLabel>
            <input
              className="input"
              type="number"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
            />
          </div>
        </div>

        <AuthError>{error}</AuthError>

        <Button type="submit" className="w-full" size="lg" loading={loading}>
          Продолжить
        </Button>
      </form>
    </div>
  );
}
