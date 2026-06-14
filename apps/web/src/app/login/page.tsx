'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { getHomePath, saveAuth } from '@/lib/auth';

const DEMO_ACCOUNTS = [
  { email: 'client@demo.fitgo', password: 'client123', role: 'Клиент' },
  { email: 'trainer@demo.fitgo', password: 'trainer123', role: 'Тренер' },
  { email: 'admin@demo.fitgo', password: 'admin123', role: 'Администратор' },
  { email: 'superadmin@demo.fitgo', password: 'super123', role: 'Супер-админ' },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('client@demo.fitgo');
  const [password, setPassword] = useState('client123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await api.login(email, password);
      saveAuth(result.accessToken, result.user);
      router.push(getHomePath(result.user.roles));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  const quickLogin = (account: (typeof DEMO_ACCOUNTS)[0]) => {
    setEmail(account.email);
    setPassword(account.password);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-fitgo-400">FITGO</p>
          <h1 className="mt-2 text-3xl font-bold">Вход в клуб</h1>
          <p className="mt-2 text-slate-400">
            Единая платформа для клиентов, тренеров и администраторов
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          <div>
            <label className="mb-2 block text-sm text-slate-400">Email</label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="mb-2 block text-sm text-slate-400">Пароль</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>

        <div className="mt-6 card">
          <p className="mb-3 text-sm font-medium text-slate-300">Демо-аккаунты</p>
          <div className="space-y-2">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                type="button"
                onClick={() => quickLogin(account)}
                className="flex w-full items-center justify-between rounded-xl border border-slate-800 px-4 py-3 text-left text-sm transition hover:border-fitgo-500/50 hover:bg-slate-800/50"
              >
                <span>{account.role}</span>
                <span className="text-slate-500">{account.email}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
