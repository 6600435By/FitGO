'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { PasswordField } from '@/components/ui/password-field';
import { api } from '@/lib/api';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [loading, setLoading] = useState(false);
  const [codeLoading, setCodeLoading] = useState(false);

  const sendCode = async () => {
    setError('');
    setCodeLoading(true);
    try {
      await api.sendPhoneCode(phone, 'reset_password');
      setOk('Код отправлен SMS');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить код');
    } finally {
      setCodeLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setOk('');
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      await api.resetPassword({
        phone: String(form.get('phone')),
        verificationCode: String(form.get('verificationCode')),
        password: String(form.get('password')),
      });
      setOk('Пароль обновлён. Можно войти.');
      setTimeout(() => router.push('/login'), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold">Новый пароль</h1>
          <p className="mt-2 text-slate-400">Код подтверждения придёт SMS</p>
        </div>
        <form onSubmit={handleSubmit} className="card space-y-4">
          <div>
            <label className="mb-2 block text-sm text-slate-400">Телефон</label>
            <input
              name="phone"
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>
          <button
            type="button"
            className="btn-secondary w-full"
            disabled={codeLoading || phone.trim().length < 9}
            onClick={() => void sendCode()}
          >
            {codeLoading ? 'Отправка…' : 'Получить код'}
          </button>
          <div>
            <label className="mb-2 block text-sm text-slate-400">Код</label>
            <input
              name="verificationCode"
              className="input"
              pattern="\d{6}"
              maxLength={6}
              required
            />
          </div>
          <div>
            <label className="mb-2 block text-sm text-slate-400">Новый пароль</label>
            <PasswordField name="password" className="input" required minLength={6} />
          </div>
          {error && (
            <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </p>
          )}
          {ok && (
            <p className="rounded-xl bg-fitgo-500/10 px-4 py-3 text-sm text-fitgo-400">
              {ok}
            </p>
          )}
          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Сохранение…' : 'Сохранить пароль'}
          </button>
          <p className="text-center text-sm text-slate-400">
            <Link href="/login" className="text-fitgo-400">
              Назад ко входу
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
