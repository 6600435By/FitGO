'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { BodyProfileResponse, ClientProfile } from '@fitgo/shared-types';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

type Tab = 'main' | 'body' | 'rating';

export default function ClientProfilePage() {
  const [tab, setTab] = useState<Tab>('main');
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [body, setBody] = useState<BodyProfileResponse | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [nickname, setNickname] = useState('');
  const [useRealName, setUseRealName] = useState(true);
  const [bodyForm, setBodyForm] = useState({ heightCm: '', targetWeightKg: '', weightKg: '' });

  const token = getToken();

  const load = () => {
    if (!token) return;
    api.clientProfile(token).then(setProfile).catch((e) => setError(e.message));
    api.bodyProfile(token).then(setBody).catch(() => {});
  };

  useEffect(load, [token]);

  useEffect(() => {
    if (profile) {
      setNickname(profile.gamificationNickname ?? '');
      setUseRealName(profile.useRealNameInPublic ?? true);
      if (body?.profile) {
        setBodyForm({
          heightCm: body.profile.heightCm?.toString() ?? '',
          targetWeightKg: body.profile.targetWeightKg?.toString() ?? '',
          weightKg: '',
        });
      }
    }
  }, [profile, body]);

  const saveProfile = async () => {
    if (!token || !profile) return;
    setError('');
    try {
      await api.updateClientProfile(token, {
        firstName: profile.firstName,
        lastName: profile.lastName,
        phone: profile.phone ?? '',
        gender: profile.gender ?? 'MALE',
        dateOfBirth: profile.dateOfBirth ?? '',
      });
      setMsg('Профиль сохранён');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const saveBody = async () => {
    if (!token) return;
    await api.updateBodyProfile(token, {
      heightCm: bodyForm.heightCm ? Number(bodyForm.heightCm) : undefined,
      targetWeightKg: bodyForm.targetWeightKg ? Number(bodyForm.targetWeightKg) : undefined,
    });
    if (bodyForm.weightKg) {
      await api.addBodyLog(token, { weightKg: Number(bodyForm.weightKg) });
    }
    setMsg('Данные тела сохранены');
    load();
  };

  const suggestNick = async () => {
    if (!token) return;
    const { nickname: n } = await api.suggestNickname(token);
    setNickname(n);
  };

  const activate = async () => {
    if (!token) return;
    if (!useRealName && nickname.length < 2) {
      setError('Выберите ник или используйте реальное имя');
      return;
    }
    if (!useRealName) {
      const check = await api.checkNickname(token, nickname);
      if (!check.available) {
        setError('Ник занят, выберите другой');
        return;
      }
    }
    if (profile?.gamificationStartedAt) {
      await api.updateGamificationSettings(token, {
        useRealNameInPublic: useRealName,
        gamificationNickname: useRealName ? undefined : nickname,
      });
      setMsg('Настройки рейтинга обновлены');
    } else {
      await api.activateGamification(token, {
        useRealNameInPublic: useRealName,
        gamificationNickname: useRealName ? undefined : nickname,
      });
      setMsg('Геймификация активирована!');
      load();
    }
  };

  if (!profile) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'main', label: 'Основное' },
    { id: 'body', label: 'Моё тело' },
    { id: 'rating', label: 'Рейтинг / ник' },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Профиль</h2>

      <div className="flex gap-2 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium ${
              tab === t.id ? 'bg-fitgo-500 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {msg && <p className="text-sm text-fitgo-400">{msg}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {tab === 'main' && (
        <div className="card space-y-3">
          <input
            className="input"
            placeholder="Имя"
            value={profile.firstName}
            onChange={(e) => setProfile({ ...profile, firstName: e.target.value })}
          />
          <input
            className="input"
            placeholder="Фамилия"
            value={profile.lastName}
            onChange={(e) => setProfile({ ...profile, lastName: e.target.value })}
          />
          <input
            className="input"
            placeholder="Телефон"
            value={profile.phone ?? ''}
            onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
          />
          <select
            className="input"
            value={profile.gender ?? 'MALE'}
            onChange={(e) => setProfile({ ...profile, gender: e.target.value })}
          >
            <option value="MALE">Мужской</option>
            <option value="FEMALE">Женский</option>
            <option value="OTHER">Другой</option>
          </select>
          <input
            className="input"
            type="date"
            value={profile.dateOfBirth ?? ''}
            onChange={(e) => setProfile({ ...profile, dateOfBirth: e.target.value })}
          />
          <button type="button" onClick={saveProfile} className="btn-primary w-full">
            Сохранить
          </button>
        </div>
      )}

      {tab === 'body' && (
        <div className="card space-y-3">
          <input
            className="input"
            type="number"
            placeholder="Рост (см)"
            value={bodyForm.heightCm}
            onChange={(e) => setBodyForm({ ...bodyForm, heightCm: e.target.value })}
          />
          <input
            className="input"
            type="number"
            placeholder="Целевой вес (кг)"
            value={bodyForm.targetWeightKg}
            onChange={(e) => setBodyForm({ ...bodyForm, targetWeightKg: e.target.value })}
          />
          <input
            className="input"
            type="number"
            placeholder="Текущий вес (кг) — новая запись"
            value={bodyForm.weightKg}
            onChange={(e) => setBodyForm({ ...bodyForm, weightKg: e.target.value })}
          />
          <button type="button" onClick={saveBody} className="btn-primary w-full">
            Сохранить замеры
          </button>

          {body && body.logs.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 font-medium">История веса</h3>
              <ul className="space-y-1 text-sm">
                {body.logs
                  .filter((l) => l.weightKg)
                  .slice(0, 10)
                  .map((l) => (
                    <li key={l.id} className="flex justify-between rounded-lg bg-slate-800/50 px-3 py-2">
                      <span>{new Date(l.recordedAt).toLocaleDateString('ru-RU')}</span>
                      <span>{l.weightKg} кг</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === 'rating' && (
        <div className="card space-y-4">
          {profile.gamificationStartedAt ? (
            <p className="text-sm text-fitgo-400">
              Геймификация активна с{' '}
              {new Date(profile.gamificationStartedAt).toLocaleDateString('ru-RU')}
            </p>
          ) : (
            <p className="text-sm text-slate-400">
              Активируйте геймификацию, чтобы участвовать в лигах и получать бейджи.
            </p>
          )}

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={useRealName}
              onChange={(e) => setUseRealName(e.target.checked)}
            />
            <span className="text-sm">Показывать реальное имя в лигах</span>
          </label>

          {!useRealName && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="Игровой ник"
                />
                <button type="button" onClick={suggestNick} className="btn-secondary">
                  Другое имя
                </button>
              </div>
            </div>
          )}

          <button type="button" onClick={activate} className="btn-primary w-full">
            {profile.gamificationStartedAt ? 'Сохранить настройки' : 'Активировать геймификацию'}
          </button>

          <Link href="/client/engagement" className="btn-secondary block text-center">
            Перейти к достижениям
          </Link>
        </div>
      )}
    </div>
  );
}
