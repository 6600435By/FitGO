'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

const STEPS = [
  {
    title: 'Ваш клуб',
    text: 'Выберите клуб на главной — имя и адрес появятся в личном кабинете.',
    href: '/client',
    cta: 'К выбору клуба',
  },
  {
    title: 'Расписание',
    text: 'Смотрите групповые программы. Запись — после оформления в клубе.',
    href: '/client/schedule',
    cta: 'Смотреть расписание',
  },
  {
    title: 'Мои записи',
    text: 'Все предстоящие занятия — в одном месте. Отмена в пару кликов.',
    href: '/client/bookings',
    cta: 'Мои записи',
  },
];

export function ClientOnboarding() {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('fitgo-onboarding-done')) return;
    const token = getToken();
    if (!token) {
      setVisible(true);
      return;
    }
    api
      .clientDashboard(token)
      .then((dash) => {
        // Skip club step if already joined
        setStep(dash.club ? 1 : 0);
        setVisible(true);
      })
      .catch(() => setVisible(true));
  }, []);

  if (!visible) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const finish = () => {
    localStorage.setItem('fitgo-onboarding-done', '1');
    setVisible(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4">
      <div className="card w-full max-w-lg">
        <p className="text-sm text-fitgo-400">
          Шаг {step + 1} из {STEPS.length}
        </p>
        <h3 className="mt-2 text-xl font-semibold">{current.title}</h3>
        <p className="mt-2 text-slate-400">{current.text}</p>
        <div className="mt-6 flex gap-2">
          {isLast ? (
            <>
              <Link href={current.href} onClick={finish} className="btn-primary flex-1 text-center">
                {current.cta}
              </Link>
              <button type="button" onClick={finish} className="btn-secondary">
                Готово
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={finish} className="btn-secondary">
                Пропустить
              </button>
              <button
                type="button"
                onClick={() => setStep((s) => s + 1)}
                className="btn-primary flex-1"
              >
                Далее
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
