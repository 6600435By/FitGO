'use client';

import { cn } from '@/lib/utils';

function scorePassword(password: string) {
  let score = 0;
  if (password.length >= 6) score += 1;
  if (password.length >= 10) score += 1;
  if (/[A-ZА-Я]/.test(password) && /[a-zа-я]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-zА-Яа-я0-9]/.test(password)) score += 1;
  return Math.min(4, score);
}

const LABELS = ['Слабый', 'Простой', 'Нормальный', 'Хороший', 'Надёжный'];
const COLORS = [
  'bg-rose-500',
  'bg-amber-500',
  'bg-forma-500',
  'bg-emerald-400',
  'bg-emerald-400',
];

export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const score = scorePassword(password);
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              i < score ? COLORS[score] : 'bg-white/10',
            )}
          />
        ))}
      </div>
      <p className="text-xs text-zinc-500">{LABELS[score]}</p>
    </div>
  );
}
