'use client';

import type { WorkoutSheet } from '@fitgo/shared-types';
import { formatBlockSessionClock, WORKOUT_SECTION_LABELS } from '@fitgo/shared-types';
import { Maximize2, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { emitWorkoutTimerDockChrome } from './workout-timer-chrome';
import type { useWorkoutSession } from './use-workout-session';

export type WorkoutSessionBarMode = 'start' | 'minimized' | 'hidden';

interface WorkoutSessionBarProps {
  mode: WorkoutSessionBarMode;
  session: ReturnType<typeof useWorkoutSession> | null;
  onStart: () => void;
  onExpand: () => void;
}

export function WorkoutSessionBar({
  mode,
  session,
  onStart,
  onExpand,
}: WorkoutSessionBarProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  const [barHeight, setBarHeight] = useState(0);

  const showBar = mode === 'start' || mode === 'minimized';

  useEffect(() => {
    if (!showBar) {
      setStuck(false);
      emitWorkoutTimerDockChrome({ active: false, atTop: false, overlayOpen: false });
      return;
    }

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const nextStuck =
          !entry.isIntersecting && entry.boundingClientRect.top < 0;
        setStuck(nextStuck);
        if (mode === 'start') {
          emitWorkoutTimerDockChrome({
            active: nextStuck,
            atTop: nextStuck,
            overlayOpen: false,
          });
        } else if (mode === 'minimized') {
          emitWorkoutTimerDockChrome({
            active: true,
            atTop: true,
            overlayOpen: false,
          });
        }
      },
      { threshold: 0 },
    );

    observer.observe(sentinel);

    if (mode === 'minimized') {
      emitWorkoutTimerDockChrome({
        active: true,
        atTop: true,
        overlayOpen: false,
      });
    }

    return () => {
      observer.disconnect();
      if (mode === 'start') {
        emitWorkoutTimerDockChrome({ active: false, atTop: false, overlayOpen: false });
      }
    };
  }, [mode, showBar]);

  useEffect(() => {
    if (!barRef.current || !showBar) return;
    const ro = new ResizeObserver(() => {
      setBarHeight(barRef.current?.offsetHeight ?? 0);
    });
    ro.observe(barRef.current);
    return () => ro.disconnect();
  }, [mode, showBar]);

  if (mode === 'hidden') {
    return null;
  }

  const phaseShort =
    session?.phase === 'work'
      ? session.running
        ? 'Работа'
        : 'Пауза'
      : session?.phase === 'rest'
        ? 'Отдых'
        : session?.phase === 'block_rest'
          ? 'Между блоками'
          : session?.phase === 'block_summary'
            ? 'Итог блока'
            : session?.phase === 'summary'
              ? 'Итог'
              : '';

  return (
    <>
      <div ref={sentinelRef} className="h-px w-full" aria-hidden />
      {stuck && barHeight > 0 && <div style={{ height: barHeight }} aria-hidden />}
      <div
        ref={barRef}
        className={cn(
          'z-20 border-slate-700 bg-slate-950/95 p-2.5 backdrop-blur-md',
          stuck || mode === 'minimized'
            ? 'fixed inset-x-0 top-0 border-b pt-[env(safe-area-inset-top)]'
            : 'mb-4 rounded-2xl border shadow-lg shadow-black/25',
        )}
      >
        <div className={cn((stuck || mode === 'minimized') && 'mx-auto max-w-lg px-4')}>
          {mode === 'start' ? (
            <button
              type="button"
              onClick={onStart}
              className="btn-primary flex w-full items-center justify-center gap-2 py-2.5 text-sm"
            >
              <Play className="h-4 w-4" />
              Начать тренировку
            </button>
          ) : (
            session && (
              <button
                type="button"
                onClick={onExpand}
                className="flex w-full items-center gap-3 rounded-xl border border-fitgo-500/40 bg-fitgo-500/10 px-3 py-2.5 text-left transition-colors hover:bg-fitgo-500/20"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] uppercase tracking-wide text-fitgo-400">
                    Таймер · {phaseShort}
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    {session.current
                      ? `${WORKOUT_SECTION_LABELS[session.current.blockId]} · ${session.current.label}`
                      : 'Тренировка'}
                  </p>
                </div>
                <p className="font-mono text-2xl font-bold tabular-nums text-white">
                  {formatBlockSessionClock(session.displaySec)}
                </p>
                <Maximize2 className="h-5 w-5 shrink-0 text-fitgo-400" />
              </button>
            )
          )}
        </div>
      </div>
    </>
  );
}
