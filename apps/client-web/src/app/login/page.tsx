'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { UserRole } from '@fitgo/shared-types';
import {
  AuthError,
  AuthShell,
  FieldLabel,
} from '@/components/forma/auth-shell';
import { Button } from '@/components/forma/button';
import { PasswordField } from '@/components/ui/password-field';
import { api } from '@/lib/api';
import { clearAuth, getHomePath, isClientUser, saveAuth } from '@/lib/auth';
import { markWelcomeSeen } from '@/lib/welcome';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    markWelcomeSeen();
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
      const result = await api.login(email, password);
      if (!isClientUser(result.user.roles)) {
        clearAuth();
        setError(
          'Это вход для клиентов. Рабочий кабинет сотрудников — app.ffs.by',
        );
        return;
      }
      saveAuth(result.accessToken, {
        ...result.user,
        roles: result.user.roles.includes(UserRole.CLIENT)
          ? result.user.roles
          : [...result.user.roles, UserRole.CLIENT],
      });
      router.push(getHomePath());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="С возвращением"
      subtitle="Абонемент, запись и визиты Forma — с телефона и компьютера"
      footer={
        <>
          Нет аккаунта?{' '}
          <Link href="/register" className="font-semibold text-forma-400">
            Создать
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="card space-y-4">
        <div>
          <FieldLabel htmlFor="login-id">Телефон или email</FieldLabel>
          <input
            id="login-id"
            type="text"
            autoComplete="username"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <FieldLabel htmlFor="login-password">Пароль</FieldLabel>
            <Link
              href="/reset-password"
              className="-mt-2 text-sm font-medium text-forma-400"
            >
              Забыли?
            </Link>
          </div>
          <PasswordField
            id="login-password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <AuthError>{error}</AuthError>

        <Button type="submit" className="w-full" size="lg" loading={loading}>
          Войти
        </Button>
      </form>
    </AuthShell>
  );
}
