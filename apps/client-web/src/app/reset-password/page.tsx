'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check } from 'lucide-react';
import {
  AuthError,
  AuthShell,
  AuthStepBar,
  AuthSuccess,
  FieldLabel,
} from '@/components/forma/auth-shell';
import { Button } from '@/components/forma/button';
import { OtpInput } from '@/components/forma/otp-input';
import { PasswordStrength } from '@/components/forma/password-strength';
import { PasswordField } from '@/components/ui/password-field';
import { api } from '@/lib/api';

type Step = 'phone' | 'code' | 'password' | 'done';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [loading, setLoading] = useState(false);
  const [codeLoading, setCodeLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = window.setTimeout(() => setResendIn((v) => v - 1), 1000);
    return () => window.clearTimeout(id);
  }, [resendIn]);

  const sendCode = async () => {
    setError('');
    setOk('');
    setCodeLoading(true);
    try {
      await api.sendPhoneCode(phone, 'reset_password');
      setResendIn(60);
      setOk('Код отправлен SMS');
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить код');
    } finally {
      setCodeLoading(false);
    }
  };

  const savePassword = async () => {
    setError('');
    setOk('');
    setLoading(true);
    try {
      await api.resetPassword({
        phone,
        verificationCode: code,
        password,
      });
      setStep('done');
      window.setTimeout(() => router.push('/login'), 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  const stepNum = step === 'phone' ? 1 : step === 'code' ? 2 : step === 'password' ? 3 : 3;

  if (step === 'done') {
    return (
      <AuthShell>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-forma-500 text-ink shadow-forma-glow"
          >
            <Check className="h-10 w-10" strokeWidth={2.5} />
          </motion.div>
          <h1 className="font-display text-3xl font-bold text-white">
            Пароль обновлён
          </h1>
          <p className="mt-2 text-zinc-400">Переходим ко входу…</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Новый пароль"
      subtitle="Подтвердите телефон кодом из SMS"
      footer={
        <Link href="/login" className="font-semibold text-forma-400">
          Назад ко входу
        </Link>
      }
    >
      <AuthStepBar step={stepNum} total={3} />

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          className="card space-y-4"
        >
          {step === 'phone' && (
            <>
              <div>
                <FieldLabel htmlFor="reset-phone">Телефон</FieldLabel>
                <input
                  id="reset-phone"
                  name="phone"
                  className="input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+375…"
                  autoComplete="tel"
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
              <OtpInput value={code} onChange={setCode} autoFocus />
              <AuthSuccess>{ok}</AuthSuccess>
              <AuthError>{error}</AuthError>
              <Button
                className="w-full"
                size="lg"
                disabled={code.length < 6}
                onClick={() => setStep('password')}
              >
                Продолжить
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-zinc-400 disabled:opacity-40"
                disabled={resendIn > 0 || codeLoading}
                onClick={() => void sendCode()}
              >
                {resendIn > 0
                  ? `Отправить ещё раз через ${resendIn} с`
                  : 'Отправить код ещё раз'}
              </button>
            </>
          )}

          {step === 'password' && (
            <>
              <div>
                <FieldLabel htmlFor="reset-password">Новый пароль</FieldLabel>
                <PasswordField
                  id="reset-password"
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
                  onClick={() => setStep('code')}
                >
                  Назад
                </Button>
                <Button
                  className="flex-[2]"
                  size="lg"
                  loading={loading}
                  disabled={password.length < 6}
                  onClick={() => void savePassword()}
                >
                  Сохранить
                </Button>
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </AuthShell>
  );
}
