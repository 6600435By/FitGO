'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getHomePath, saveAuth } from '@/lib/auth';
import { TrainerOnboarding } from '@/components/client/trainer-onboarding';

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<'form' | 'trainers'>('form');
  const [token, setToken] = useState('');
  const [pendingTrainers, setPendingTrainers] = useState<
    Awaited<ReturnType<typeof api.register>>['pendingTrainers']
  >([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const form = new FormData(e.currentTarget);

    try {
      const result = await api.register({
        email: String(form.get('email')),
        password: String(form.get('password')),
        firstName: String(form.get('firstName')),
        lastName: String(form.get('lastName')),
        phone: String(form.get('phone')),
      });

      saveAuth(result.accessToken, result.user);
      setToken(result.accessToken);

      if (result.pendingTrainers.length > 0) {
        setPendingTrainers(result.pendingTrainers);
        setStep('trainers');
      } else {
        router.push(getHomePath(result.user.roles));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка регистрации');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'trainers') {
    return (
      <TrainerOnboarding
        token={token}
        initialRequests={pendingTrainers}
        onComplete={() => router.push('/client')}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-fitgo-400">FITGO</p>
          <h1 className="mt-2 text-3xl font-bold">Регистрация</h1>
          <p className="mt-2 text-slate-400">
            Создайте аккаунт клиента. Клуб можно привязать позже.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-slate-400">Имя</label>
              <input name="firstName" className="input" required />
            </div>
            <div>
              <label className="mb-2 block text-sm text-slate-400">Фамилия</label>
              <input name="lastName" className="input" required />
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm text-slate-400">Телефон</label>
            <input name="phone" type="tel" className="input" required />
          </div>
          <div>
            <label className="mb-2 block text-sm text-slate-400">Email</label>
            <input name="email" type="email" className="input" required />
          </div>
          <div>
            <label className="mb-2 block text-sm text-slate-400">Пароль</label>
            <input name="password" type="password" className="input" minLength={6} required />
          </div>

          {error && (
            <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Регистрация...' : 'Зарегистрироваться'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-400">
          Уже есть аккаунт?{' '}
          <Link href="/login" className="text-fitgo-400 hover:underline">
            Войти
          </Link>
        </p>
      </div>
    </div>
  );
}
