'use client';

import type { SpaWaitlistEntry } from '@fitgo/shared-types';
import {
  formatSpaWaitlistPreference,
  spaWaitlistFitsSlot,
} from '@fitgo/shared-types';
import { useEffect, useMemo, useState } from 'react';

export function SpaWaitlistPickDialog({
  open,
  title,
  entries,
  specialistId,
  slotStartAt,
  slotEndAt,
  serviceDurationMin,
  showSpecialist,
  busy,
  onClose,
  onBook,
  onNewBooking,
}: {
  open: boolean;
  title?: string;
  entries: SpaWaitlistEntry[];
  specialistId?: string;
  slotStartAt?: string;
  slotEndAt?: string;
  /** Used to flag when a WINDOW booking would run past the hour band. */
  serviceDurationMin?: number;
  showSpecialist?: boolean;
  busy?: boolean;
  onClose: () => void;
  onBook: (entry: SpaWaitlistEntry) => Promise<void>;
  onNewBooking?: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    setShowAll(false);
  }, [open, slotStartAt, specialistId]);

  const ranked = useMemo(() => {
    const scored = entries.map((e) => {
      let score = 0;
      if (specialistId && e.specialistId === specialistId) score += 100;
      if (slotStartAt && specialistId) {
        const match = spaWaitlistFitsSlot(
          e,
          specialistId,
          slotStartAt,
          slotEndAt,
          serviceDurationMin,
        );
        if (match.fits) {
          score += 50;
          if (match.exceedsWindow) score -= 5;
        } else if (e.preference !== 'WINDOW') {
          const s = new Date(e.desiredStartAt).getTime();
          const slotT = new Date(slotStartAt).getTime();
          if (!Number.isNaN(s) && !Number.isNaN(slotT)) {
            score -= Math.min(40, Math.abs(s - slotT) / 60000);
          }
        } else {
          score -= 40;
        }
      }
      // Prefer longer waiting
      score += Math.min(
        10,
        (Date.now() - new Date(e.createdAt).getTime()) / (86_400_000 * 3),
      );
      return { e, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.map((x) => x.e);
  }, [
    entries,
    specialistId,
    slotStartAt,
    slotEndAt,
    serviceDurationMin,
  ]);

  const preferred = useMemo(() => {
    if (!slotStartAt || !specialistId) return ranked;
    return ranked.filter(
      (e) =>
        spaWaitlistFitsSlot(
          e,
          specialistId,
          slotStartAt,
          slotEndAt,
          serviceDurationMin,
        ).fits,
    );
  }, [
    ranked,
    specialistId,
    slotStartAt,
    slotEndAt,
    serviceDurationMin,
  ]);

  const list = showAll || preferred.length === 0 ? ranked : preferred;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="card max-h-[min(92dvh,100%)] w-full max-w-md space-y-3 overflow-y-auto rounded-b-none sm:rounded-2xl">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium">{title ?? 'Лист ожидания'}</h3>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={onClose}
          >
            Закрыть
          </button>
        </div>

        <p className="text-xs text-slate-400">
          Выберите клиента из листа или создайте обычную запись.
        </p>

        {list.length === 0 ? (
          <p className="text-sm text-slate-500">Заявок нет</p>
        ) : (
          <ul className="space-y-2">
            {list.map((e) => {
              const match =
                slotStartAt && specialistId
                  ? spaWaitlistFitsSlot(
                      e,
                      specialistId,
                      slotStartAt,
                      slotEndAt,
                      serviceDurationMin,
                    )
                  : { fits: false, exceedsWindow: false };
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition ${
                      selectedId === e.id
                        ? 'border-fitgo-500 bg-fitgo-500/10'
                        : 'border-white/10 bg-slate-900/40'
                    }`}
                    onClick={() => setSelectedId(e.id)}
                  >
                    <p className="font-medium">{e.clientName}</p>
                    <p className="text-slate-400">
                      {e.serviceName}
                      {showSpecialist ? ` · ${e.specialistName}` : ''}
                    </p>
                    <p className="text-xs text-slate-300">
                      {formatSpaWaitlistPreference(e)}
                    </p>
                    {e.note ? (
                      <p className="text-xs text-slate-500">{e.note}</p>
                    ) : null}
                    {match.fits && match.exceedsWindow ? (
                      <p className="text-xs text-amber-300/90">уйдёт за окно</p>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {preferred.length > 0 && preferred.length < ranked.length ? (
          <button
            type="button"
            className="btn-secondary w-full text-xs"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? 'Только подходящие' : 'Показать весь лист дня'}
          </button>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary flex-1"
            disabled={busy || !selectedId}
            onClick={() => {
              const entry = entries.find((e) => e.id === selectedId);
              if (!entry) return;
              void onBook(entry);
            }}
          >
            Записать из листа
          </button>
          {onNewBooking ? (
            <button
              type="button"
              className="btn-secondary flex-1"
              disabled={busy}
              onClick={onNewBooking}
            >
              Новая запись
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
