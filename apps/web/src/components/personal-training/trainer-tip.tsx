'use client';

import { Info, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  WORKOUT_TRAINER_TIPS,
  type WorkoutTipId,
} from './workout-trainer-tips';

interface TrainerTipProps {
  tipId: WorkoutTipId;
  className?: string;
}

export function TrainerTip({ tipId, className = '' }: TrainerTipProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const tip = WORKOUT_TRAINER_TIPS[tipId];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex shrink-0 items-center justify-center rounded-full p-0.5 text-fitgo-400 hover:bg-fitgo-500/10 hover:text-fitgo-300 ${className}`}
        title="Подсказка тренера"
        aria-label={`Подсказка: ${tip.title}`}
      >
        <Info className="h-4 w-4" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-labelledby={`tip-${tipId}-title`}
            className="card w-full max-w-md max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <h4 id={`tip-${tipId}-title`} className="text-lg font-semibold text-fitgo-300">
                {tip.title}
              </h4>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                aria-label="Закрыть"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
              {tip.body}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn-primary mt-4 w-full"
            >
              Понятно
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** Заголовок секции с иконкой подсказки */
export function SectionTitle({
  children,
  tipId,
}: {
  children: React.ReactNode;
  tipId?: WorkoutTipId;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <h4 className="font-semibold">{children}</h4>
      {tipId && <TrainerTip tipId={tipId} />}
    </div>
  );
}
