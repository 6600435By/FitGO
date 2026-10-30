'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { TrainerOnboarding } from '@/components/client/trainer-onboarding';
import { PasswordField } from '@/components/ui/password-field';
import { api } from '@/lib/api';
import { getHomePath, saveAuth } from '@/lib/auth';

/** Bump when legal texts on ffs.by change. */
const PRIVACY_VERSION = '2026-04-01';
const TERMS_VERSION = '2026-04-01';

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<'form' | 'trainers'>('form');
  const [token, setToken] = useState('');
  const [pendingTrainers, setPendingTrainers] = useState<
    Awaited<ReturnType<typeof api.register>>['pendingTrainers']
  >([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [codeLoading, setCodeLoading] = useState(false);
  const [phone, setPhone] = useState('');

  const sendCode = async () => {
    setError('');
    setCodeLoading(true);
    try {
      await api.sendPhoneCode(phone, 'register');
      setCodeSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить код');
    } finally {
      setCodeLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const privacy = form.get('privacy') === 'on';
    const terms = form.get('terms') === 'on';
    if (!privacy || !terms) {
      setError('Нужно принять политику и пользовательское соглашение');
      setLoading(false);
      return;
    }

    try {
      const result = await api.register({
        email: String(form.get('email')),
        password: String(form.get('password')),
        firstName: String(form.get('firstName')),
        lastName: String(form.get('lastName')),
        phone: String(form.get('phone')),
        verificationCode: String(form.get('verificationCode')),
        privacyConsentVersion: PRIVACY_VERSION,
        termsConsentVersion: TERMS_VERSION,
        marketingConsent: form.get('marketing') === 'on',
      });

      saveAuth(result.accessToken, result.user);
      setToken(result.accessToken);

      if (result.pendingTrainers.length > 0) {
        setPendingTrainers(result.pendingTrainers);
        setStep('trainers');
      } else {
        router.push(getHomePath());
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
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-fitgo-400">
            Forma
          </p>
          <h1 className="mt-2 text-3xl font-bold">Регистрация</h1>
          <p className="mt-2 text-slate-400">
            Код придёт SMS на номер из карточки клуба
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          <div className="grid grid-cols-2 gap-3">
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
            <input
              name="phone"
              className="input"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setCodeSent(false);
              }}
              placeholder="+375…"
              required
            />
          </div>
          <button
            type="button"
            className="btn-secondary w-full"
            disabled={codeLoading || phone.trim().length < 9}
            onClick={() => void sendCode()}
          >
            {codeLoading
              ? 'Отправка…'
              : codeSent
                ? 'Отправить код ещё раз'
                : 'Получить код SMS'}
          </button>
          <div>
            <label className="mb-2 block text-sm text-slate-400">Код из SMS</label>
            <input
              name="verificationCode"
              className="input"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              placeholder="6 цифр"
              required
            />
          </div>
          <div>
            <label className="mb-2 block text-sm text-slate-400">Email</label>
            <input name="email" type="email" className="input" required />
          </div>
          <div>
            <label className="mb-2 block text-sm text-slate-400">Пароль</label>
            <PasswordField name="password" className="input" required minLength={6} />
          </div>

          <label className="flex gap-2 text-sm text-slate-300">
            <input name="privacy" type="checkbox" className="mt-1" required />
            <span>
              Согласен на обработку персональных данных (версия {PRIVACY_VERSION})
            </span>
          </label>
          <label className="flex gap-2 text-sm text-slate-300">
            <input name="terms" type="checkbox" className="mt-1" required />
            <span>
              Принимаю пользовательское соглашение (версия {TERMS_VERSION})
            </span>
          </label>
          <label className="flex gap-2 text-sm text-slate-300">
            <input name="marketing" type="checkbox" className="mt-1" />
            <span>Хочу получать новости клуба (необязательно)</span>
          </label>

          {error && (
            <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Создание…' : 'Зарегистрироваться'}
          </button>

          <p className="text-center text-sm text-slate-400">
            Уже есть аккаунт?{' '}
            <Link href="/login" className="text-fitgo-400">
              Войти
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
