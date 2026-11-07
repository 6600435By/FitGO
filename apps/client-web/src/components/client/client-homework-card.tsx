'use client';

import { ProgressRing } from '@fitgo/forma-ui';
import { motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { cn } from '@/lib/utils';

type Homework = NonNullable<
  Awaited<ReturnType<typeof api.clientActiveHomework>>
>;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function ClientHomeworkCard() {
  const reduceMotion = useReducedMotion();
  const [hw, setHw] = useState<Homework | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;
    api
      .clientActiveHomework(token)
      .then(setHw)
      .catch(() => setHw(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!hw || hw.status !== 'ACTIVE') return null;

  const pct =
    hw.progress.total <= 0
      ? 0
      : Math.round((hw.progress.done / hw.progress.total) * 100);

  const toggle = async (itemId: string, already: boolean) => {
    const token = getToken();
    if (!token || already) return;
    setBusyId(itemId);
    try {
      if (typeof navigator !== 'undefined') navigator.vibrate?.(20);
      const next = await api.clientCheckHomeworkItem(
        token,
        itemId,
        todayKey(),
        true,
      );
      setHw((prev) =>
        prev
          ? {
              ...prev,
              status: next.status,
              progress: next.progress,
              items: prev.items.map((it) => {
                const hit = next.items.find((n) => n.id === it.id);
                return hit
                  ? {
                      ...it,
                      complete: hit.complete,
                      doneCount: hit.doneCount,
                    }
                  : it;
              }),
            }
          : prev,
      );
      if (
        next.progress.done >= next.progress.total &&
        next.progress.total > 0
      ) {
        setCelebrate(true);
        window.setTimeout(() => setCelebrate(false), 2500);
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-3xl border border-white/10 bg-ink-elevated/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-forma-400/80">
            Задание от тренера
          </p>
          <p className="mt-1 font-display text-lg font-semibold text-white">
            {hw.trainerName || 'Тренер'}
          </p>
          {hw.summary ? (
            <p className="mt-1 text-sm text-zinc-400">{hw.summary}</p>
          ) : null}
        </div>
        <ProgressRing value={pct} size={56} stroke={5}>
          <span className="text-[11px] font-semibold text-forma-400">
            {hw.progress.done}/{hw.progress.total}
          </span>
        </ProgressRing>
      </div>

      <ul className="mt-4 space-y-2">
        {hw.items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              disabled={item.complete || busyId === item.id}
              onClick={() => void toggle(item.id, item.complete)}
              className={cn(
                'flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition',
                item.complete
                  ? 'border-emerald-500/30 bg-emerald-500/10'
                  : 'border-white/10 bg-ink-raised/60 active:scale-[0.99]',
              )}
            >
              <span
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full border text-sm',
                  item.complete
                    ? 'border-emerald-400 bg-emerald-400 text-ink'
                    : 'border-white/20 text-zinc-500',
                )}
              >
                {item.complete ? '✓' : ''}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-white">
                  {item.title}
                </span>
                {item.target ? (
                  <span className="text-xs text-zinc-500">{item.target}</span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {celebrate && !reduceMotion ? (
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 text-center text-sm text-forma-400"
        >
          Тренер увидит твой результат ✨
        </motion.p>
      ) : null}
    </section>
  );
}
