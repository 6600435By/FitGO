'use client';

import { UserRole } from '@fitgo/shared-types';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { api } from '@/lib/api';
import { requireSpecialist, saveAuth } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.login(email.trim(), password);
      if (!requireSpecialist(res.user)) {
        throw new Error('Доступ только для SPA-специалиста');
      }
      // SUPER_ADMIN may also have SPECIALIST in rare cases — still OK if SPECIALIST present
      if (
        res.user.roles.includes(UserRole.CLIENT) &&
        res.user.roles.length === 1
      ) {
        throw new Error('Доступ только для SPA-специалиста');
      }
      saveAuth(res.accessToken, res.user);
      router.replace('/journal');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка входа');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shell justify-center">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <p className="font-display text-4xl tracking-tight">FitGO</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            Кабинет SPA-специалиста
          </p>
        </div>
        <ThemeToggle />
      </div>
      <form className="panel space-y-4" onSubmit={onSubmit}>
        <label className="block space-y-1.5 text-sm">
          <span style={{ color: 'var(--muted)' }}>Email</span>
          <input
            className="field"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span style={{ color: 'var(--muted)' }}>Пароль</span>
          <input
            className="field"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <p className="text-sm" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
