'use client';

import { BentoCard } from '@fitgo/forma-ui';
import { Flame, Trophy } from 'lucide-react';
import type { MotivationRecords } from '@/lib/trainer-motivation';

export function MotivationCard({ records }: { records: MotivationRecords }) {
  const items: Array<{ label: string; value: string; hint?: string }> = [];

  if (records.ptSessions > 0) {
    items.push({
      label: 'ПТ за месяц',
      value: String(records.ptSessions),
      hint: records.ptIsRecord
        ? `рекорд · было ${records.ptPrev}`
        : records.ptPrev > 0
          ? `прошлый месяц ${records.ptPrev}`
          : undefined,
    });
  }

  if (records.fillPct != null) {
    items.push({
      label: 'Заполняемость ГП',
      value: `${records.fillPct}%`,
      hint: records.fillIsRecord
        ? `рекорд · было ${records.fillPrev}%`
        : records.fillPrev != null
          ? `прошлый месяц ${records.fillPrev}%`
          : undefined,
    });
  }

  if (records.journalWeekStreak > 0) {
    items.push({
      label: 'Серия журнала',
      value: `${records.journalWeekStreak}`,
      hint:
        records.journalWeekStreak === 1
          ? 'неделя без пропуска'
          : 'недель без пропуска',
    });
  }

  if (records.ladderPercent != null) {
    items.push({
      label: 'Лестница ПТ',
      value: `${records.ladderPercent}%`,
      hint: records.ladderIsTop
        ? 'верхняя ступень · календарный месяц'
        : records.ladderRemaining != null
          ? `календарный месяц · ещё ${records.ladderRemaining} до следующей (порог 0 = первая ступень)`
          : 'календарный месяц · доверенные ПТ ЗП',
    });
  }

  if (items.length === 0) return null;

  return (
    <BentoCard
      title="Мотивация"
      action={
        <span className="inline-flex items-center gap-1 text-[11px] text-forma-400">
          <Trophy className="h-3.5 w-3.5" />
          месяц
        </span>
      }
    >
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li
            key={item.label}
            className="rounded-2xl border border-white/[0.06] bg-ink-raised/60 px-3 py-2.5"
          >
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">
              {item.label}
            </p>
            <p className="mt-0.5 font-display text-2xl font-bold tabular-nums text-white">
              {item.value}
            </p>
            {item.hint ? (
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-500">
                {item.hint.includes('рекорд') || item.hint.includes('недел') ? (
                  <Flame className="h-3 w-3 text-forma-400" />
                ) : null}
                {item.hint}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </BentoCard>
  );
}
