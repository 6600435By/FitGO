'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { PasswordField } from '@/components/ui/password-field';
import { api } from '@/lib/api';
import { getHomePath, saveAuth } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem('fitgo_session_expired') === '1') {
        sessionStorage.removeItem('fitgo_session_expired');
        setError('Сессия истекла после обновления сервера. Войдите снова.');
      }
    } catch {
      /* private mode */
    }
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await api.login(login, password);
      saveAuth(result.accessToken, result.user, { remember });
      const home = getHomePath(result.user.roles, {
        groupPrograms: result.user.groupPrograms,
        trainerStaff: result.user.trainerStaff,
        trainerClub: result.user.trainerClub,
      });
      if (/^https?:\/\//i.test(home)) {
        window.location.assign(home);
        return;
      }
      router.push(home);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка входа';
      if (/неверн/i.test(msg) || /unauthorized/i.test(msg)) {
        setError('Неверный телефон, логин или пароль');
      } else if (/деактив/i.test(msg)) {
        setError('Аккаунт деактивирован. Обратитесь к администратору клуба.');
      } else if (/не открыт/i.test(msg)) {
        setError('Вход для сотрудника ещё не открыт. Напишите управляющему.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-fitgo-400">
            FITGO
          </p>
          <h1 className="mt-2 text-3xl font-bold">Вход в клуб</h1>
          <p className="mt-2 text-slate-400">
            Рабочий кабинет сотрудников. Клиентам —{' '}
            <a
              href="https://lk.ffs.by"
              className="text-fitgo-400 underline-offset-2 hover:underline"
            >
              lk.ffs.by
            </a>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          <div>
            <label className="mb-2 block text-sm text-slate-400" htmlFor="login">
              Телефон или логин
            </label>
            <input
              id="login"
              type="text"
              autoComplete="username"
              className="input"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="+375…"
              required
            />
          </div>
          <div>
            <label
              className="mb-2 block text-sm text-slate-400"
              htmlFor="password"
            >
              Пароль
            </label>
            <PasswordField
              id="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-900 accent-fitgo-500"
            />
            Запомнить меня на этом устройстве
          </label>

          {error ? (
            <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </p>
          ) : null}

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Вход…' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}
