'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { CreditCard, CalendarCheck, Trophy } from 'lucide-react';
import { FormaWordmark } from '@/components/forma/wordmark';
import { Button } from '@/components/forma/button';
import { markWelcomeSeen } from '@/lib/welcome';
import { cn } from '@/lib/utils';

const SLIDES = [
  {
    icon: CreditCard,
    title: 'Пропуск всегда под рукой',
    text: 'Откройте штрихкод на входе за секунду — даже без интернета.',
  },
  {
    icon: CalendarCheck,
    title: 'Запись в один тап',
    text: 'Групповые, персональные и SPA — выберите день и подтвердите.',
  },
  {
    icon: Trophy,
    title: 'Видно прогресс',
    text: 'Визиты, серия дней и достижения клуба Forma в одном месте.',
  },
] as const;

export default function WelcomePage() {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index];
  const Icon = slide.icon;
  const last = index === SLIDES.length - 1;

  const finish = (href: string) => {
    markWelcomeSeen();
    router.push(href);
  };

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
      >
        <div className="absolute -right-20 top-10 h-80 w-80 rounded-full bg-forma-500/20 blur-3xl" />
        <div className="absolute -left-24 bottom-32 h-72 w-72 rounded-full bg-forma-500/10 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="flex items-center justify-between">
          <FormaWordmark size="sm" />
          <button
            type="button"
            className="text-sm font-medium text-zinc-400 touch-manipulation hover:text-white"
            onClick={() => finish('/login')}
          >
            Пропустить
          </button>
        </div>

        <div className="flex flex-1 flex-col justify-center py-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={index}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.28, ease: 'easeOut' }}
              className="text-center"
            >
              <div className="mx-auto mb-8 flex h-28 w-28 items-center justify-center rounded-[2rem] bg-forma-500 text-ink shadow-forma-glow">
                <Icon className="h-12 w-12" strokeWidth={2.25} />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-white">
                {slide.title}
              </h1>
              <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-zinc-400">
                {slide.text}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="mb-6 flex justify-center gap-2">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Слайд ${i + 1}`}
              onClick={() => setIndex(i)}
              className={cn(
                'h-1.5 rounded-full transition-all touch-manipulation',
                i === index ? 'w-8 bg-forma-500' : 'w-1.5 bg-white/20',
              )}
            />
          ))}
        </div>

        {last ? (
          <div className="space-y-3">
            <Button className="w-full" size="lg" onClick={() => finish('/register')}>
              Создать аккаунт
            </Button>
            <Button
              className="w-full"
              variant="secondary"
              size="lg"
              onClick={() => finish('/login')}
            >
              Уже есть аккаунт — войти
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Button className="w-full" size="lg" onClick={() => setIndex((v) => v + 1)}>
              Дальше
            </Button>
            <p className="text-center text-sm text-zinc-500">
              Уже с нами?{' '}
              <Link
                href="/login"
                className="font-medium text-forma-400"
                onClick={() => markWelcomeSeen()}
              >
                Войти
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
