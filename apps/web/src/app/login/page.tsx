'use client';

import {
  AuthError,
  AuthShell,
  Button,
  FieldLabel,
} from '@fitgo/forma-ui';
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
    <div className="forma-theme min-h-dvh bg-ink text-zinc-100">
      <AuthShell
        brand="coach"
        title="Вход"
        subtitle="Кабинет тренера и сотрудников Forma. Клиентам — lk.ffs.by"
        footer={
          <a
            href="https://lk.ffs.by"
            className="text-forma-400 underline-offset-2 hover:underline"
          >
            Личный кабинет клиента
          </a>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <FieldLabel htmlFor="login">Телефон или логин</FieldLabel>
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
            <FieldLabel htmlFor="password">Пароль</FieldLabel>
            <PasswordField
              id="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-ink-elevated accent-forma-500"
            />
            Запомнить меня на этом устройстве
          </label>

          <AuthError>{error}</AuthError>

          <Button type="submit" className="w-full" loading={loading}>
            {loading ? 'Вход…' : 'Войти'}
          </Button>
        </form>
      </AuthShell>
    </div>
  );
}
