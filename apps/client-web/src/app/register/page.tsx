'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import confetti from 'canvas-confetti';
import { Check } from 'lucide-react';
import { TrainerOnboarding } from '@/components/client/trainer-onboarding';
import {
  AuthError,
  AuthShell,
  AuthStepBar,
  FieldLabel,
} from '@/components/forma/auth-shell';
import { Button } from '@/components/forma/button';
import { OtpInput } from '@/components/forma/otp-input';
import { PasswordStrength } from '@/components/forma/password-strength';
import { PasswordField } from '@/components/ui/password-field';
import { api } from '@/lib/api';
import { getHomePath, saveAuth } from '@/lib/auth';
import { markWelcomeSeen } from '@/lib/welcome';
import { cn } from '@/lib/utils';

/** Bump when legal texts on ffs.by change. */
const PRIVACY_VERSION = '2026-04-01';
const TERMS_VERSION = '2026-04-01';

const STEP_ORDER = [
  'phone',
  'code',
  'name',
  'credentials',
  'consents',
] as const;

type FormStep = (typeof STEP_ORDER)[number];
type WizardStep = FormStep | 'success' | 'trainers';

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>('phone');
  const [token, setToken] = useState('');
  const [pendingTrainers, setPendingTrainers] = useState<
    Awaited<ReturnType<typeof api.register>>['pendingTrainers']
  >([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [codeLoading, setCodeLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const [terms, setTerms] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    markWelcomeSeen();
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = window.setTimeout(() => setResendIn((v) => v - 1), 1000);
    return () => window.clearTimeout(id);
  }, [resendIn]);

  const stepIndex = Math.max(
    1,
    STEP_ORDER.indexOf(step as FormStep) + 1,
  );

  const sendCode = async () => {
    setError('');
    setCodeLoading(true);
    try {
      await api.sendPhoneCode(phone, 'register');
      setResendIn(60);
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить код');
    } finally {
      setCodeLoading(false);
    }
  };

  const submitRegister = async () => {
    if (!privacy || !terms) {
      setError('Нужно принять политику и пользовательское соглашение');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const result = await api.register({
        email,
        password,
        firstName,
        lastName,
        phone,
        verificationCode: code,
        privacyConsentVersion: PRIVACY_VERSION,
        termsConsentVersion: TERMS_VERSION,
        marketingConsent: marketing,
      });

      saveAuth(result.accessToken, result.user);
      setToken(result.accessToken);
      setPendingTrainers(result.pendingTrainers);
      setStep('success');

      void confetti({
        particleCount: 90,
        spread: 70,
        origin: { y: 0.65 },
        colors: ['#FFD000', '#FFFFFF', '#FFE685'],
      });

      window.setTimeout(() => {
        if (result.pendingTrainers.length > 0) {
          setStep('trainers');
        } else {
          router.push(getHomePath());
        }
      }, 1600);
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

  if (step === 'success') {
    return (
      <AuthShell>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-forma-500 text-ink shadow-forma-glow"
          >
            <Check className="h-10 w-10" strokeWidth={2.5} />
          </motion.div>
          <h1 className="font-display text-3xl font-bold text-white">
            Добро пожаловать!
          </h1>
          <p className="mt-2 text-zinc-400">Аккаунт Forma готов</p>
        </div>
      </AuthShell>
    );
  }

  const titles: Record<FormStep, { title: string; subtitle: string }> = {
    phone: {
      title: 'Ваш телефон',
      subtitle: 'Код придёт SMS на номер из карточки клуба',
    },
    code: {
      title: 'Код из SMS',
      subtitle: `Отправили на ${phone || 'ваш номер'}`,
    },
    name: {
      title: 'Как вас зовут?',
      subtitle: 'Так вас увидят тренеры и ресепшен',
    },
    credentials: {
      title: 'Email и пароль',
      subtitle: 'Для входа с любого устройства',
    },
    consents: {
      title: 'Почти готово',
      subtitle: 'Подтвердите согласия — и можно в клуб',
    },
  };

  const meta = titles[step as FormStep];

  return (
    <AuthShell
      title={meta.title}
      subtitle={meta.subtitle}
      footer={
        step === 'phone' ? (
          <>
            Уже есть аккаунт?{' '}
            <Link href="/login" className="font-semibold text-forma-400">
              Войти
            </Link>
          </>
        ) : undefined
      }
    >
      <AuthStepBar step={stepIndex} total={STEP_ORDER.length} />

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.22 }}
          className="card space-y-4"
        >
          {step === 'phone' && (
            <>
              <div>
                <FieldLabel htmlFor="reg-phone">Телефон</FieldLabel>
                <input
                  id="reg-phone"
                  className="input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+375…"
                  autoComplete="tel"
                  inputMode="tel"
                  required
                />
              </div>
              <AuthError>{error}</AuthError>
              <Button
                className="w-full"
                size="lg"
                loading={codeLoading}
                disabled={phone.trim().length < 9}
                onClick={() => void sendCode()}
              >
                Получить код
              </Button>
            </>
          )}

          {step === 'code' && (
            <>
              <OtpInput
                value={code}
                onChange={setCode}
                autoFocus
              />
              <AuthError>{error}</AuthError>
              <Button
                className="w-full"
                size="lg"
                disabled={code.length < 6}
                onClick={() => {
                  setError('');
                  setStep('name');
                }}
              >
                Продолжить
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-zinc-400 touch-manipulation disabled:opacity-40"
                disabled={resendIn > 0 || codeLoading}
                onClick={() => void sendCode()}
              >
                {resendIn > 0
                  ? `Отправить ещё раз через ${resendIn} с`
                  : 'Отправить код ещё раз'}
              </button>
              <button
                type="button"
                className="w-full text-center text-sm text-zinc-500"
                onClick={() => setStep('phone')}
              >
                Изменить номер
              </button>
            </>
          )}

          {step === 'name' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel htmlFor="reg-first">Имя</FieldLabel>
                  <input
                    id="reg-first"
                    className="input"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoComplete="given-name"
                    required
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="reg-last">Фамилия</FieldLabel>
                  <input
                    id="reg-last"
                    className="input"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    autoComplete="family-name"
                    required
                  />
                </div>
              </div>
              <AuthError>{error}</AuthError>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setStep('code')}
                >
                  Назад
                </Button>
                <Button
                  className="flex-[2]"
                  size="lg"
                  disabled={!firstName.trim() || !lastName.trim()}
                  onClick={() => setStep('credentials')}
                >
                  Далее
                </Button>
              </div>
            </>
          )}

          {step === 'credentials' && (
            <>
              <div>
                <FieldLabel htmlFor="reg-email">Email</FieldLabel>
                <input
                  id="reg-email"
                  type="email"
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div>
                <FieldLabel htmlFor="reg-password">Пароль</FieldLabel>
                <PasswordField
                  id="reg-password"
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  isNew
                  required
                  minLength={6}
                />
                <div className="mt-2">
                  <PasswordStrength password={password} />
                </div>
              </div>
              <AuthError>{error}</AuthError>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setStep('name')}
                >
                  Назад
                </Button>
                <Button
                  className="flex-[2]"
                  size="lg"
                  disabled={!email.trim() || password.length < 6}
                  onClick={() => setStep('consents')}
                >
                  Далее
                </Button>
              </div>
            </>
          )}

          {step === 'consents' && (
            <>
              <label className="flex gap-3 rounded-2xl border border-white/10 bg-ink-raised/60 p-3 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-forma-500"
                  checked={privacy}
                  onChange={(e) => setPrivacy(e.target.checked)}
                />
                <span>
                  Согласен на обработку персональных данных (версия{' '}
                  {PRIVACY_VERSION})
                </span>
              </label>
              <label className="flex gap-3 rounded-2xl border border-white/10 bg-ink-raised/60 p-3 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-forma-500"
                  checked={terms}
                  onChange={(e) => setTerms(e.target.checked)}
                />
                <span>
                  Принимаю пользовательское соглашение (версия {TERMS_VERSION})
                </span>
              </label>
              <label className="flex gap-3 rounded-2xl border border-white/10 bg-ink-raised/40 p-3 text-sm text-zinc-400">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-forma-500"
                  checked={marketing}
                  onChange={(e) => setMarketing(e.target.checked)}
                />
                <span>Хочу получать новости клуба (необязательно)</span>
              </label>
              <AuthError>{error}</AuthError>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setStep('credentials')}
                >
                  Назад
                </Button>
                <Button
                  className={cn('flex-[2]')}
                  size="lg"
                  loading={loading}
                  disabled={!privacy || !terms}
                  onClick={() => void submitRegister()}
                >
                  Создать аккаунт
                </Button>
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </AuthShell>
  );
}
