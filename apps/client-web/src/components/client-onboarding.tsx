'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/forma/button';
import { FormaWordmark } from '@/components/forma/wordmark';

const STEPS = [
  {
    title: 'Добро пожаловать в Forma',
    text: 'Личный кабинет вашего клуба: расписание, записи и прогресс — в одном месте.',
    href: '/client',
    cta: 'На главную',
  },
  {
    title: 'Расписание',
    text: 'Смотрите групповые программы и персональные слоты. Запись — в пару касаний.',
    href: '/client/schedule',
    cta: 'Смотреть расписание',
  },
  {
    title: 'Мои записи',
    text: 'Все предстоящие занятия — здесь. Отмена без лишних экранов.',
    href: '/client/bookings',
    cta: 'Мои записи',
  },
];

export function ClientOnboarding() {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('fitgo-onboarding-done')) return;
    setVisible(true);
  }, []);

  if (!visible) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const finish = () => {
    localStorage.setItem('fitgo-onboarding-done', '1');
    setVisible(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center">
      <div className="card w-full max-w-lg space-y-4 border-forma-500/20">
        <FormaWordmark size="sm" />
        <p className="text-xs font-medium uppercase tracking-wider text-forma-400">
          Шаг {step + 1} из {STEPS.length}
        </p>
        <h3 className="font-display text-2xl font-bold text-white">
          {current.title}
        </h3>
        <p className="text-zinc-400">{current.text}</p>
        <div className="flex gap-2 pt-2">
          {isLast ? (
            <>
              <Link
                href={current.href}
                onClick={finish}
                className="inline-flex flex-1 items-center justify-center rounded-2xl bg-forma-500 px-4 py-3.5 text-[15px] font-semibold text-ink touch-manipulation hover:bg-forma-400"
              >
                {current.cta}
              </Link>
              <Button variant="secondary" onClick={finish}>
                Готово
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={finish}>
                Пропустить
              </Button>
              <Button className="flex-1" onClick={() => setStep((s) => s + 1)}>
                Далее
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
