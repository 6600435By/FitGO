'use client';

import type { SpaWaitlistEntry } from '@fitgo/shared-types';
import { useEffect, useMemo, useState } from 'react';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SpaWaitlistPickDialog({
  open,
  title,
  entries,
  specialistId,
  slotStartAt,
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
    const slotT = slotStartAt ? new Date(slotStartAt).getTime() : null;
    const scored = entries.map((e) => {
      let score = 0;
      if (specialistId && e.specialistId === specialistId) score += 100;
      if (slotT != null) {
        const s = new Date(e.desiredStartAt).getTime();
        const end = new Date(e.desiredEndAt).getTime();
        if (s <= slotT && end > slotT) score += 50;
        else score -= Math.min(40, Math.abs(s - slotT) / 60000);
      }
      return { e, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.map((x) => x.e);
  }, [entries, specialistId, slotStartAt]);

  const preferred = useMemo(() => {
    if (!slotStartAt || !specialistId) return ranked;
    const t = new Date(slotStartAt).getTime();
    return ranked.filter((e) => {
      if (e.specialistId !== specialistId) return false;
      const s = new Date(e.desiredStartAt).getTime();
      const end = new Date(e.desiredEndAt).getTime();
      return s <= t && end > t;
    });
  }, [ranked, specialistId, slotStartAt]);

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
            {list.map((e) => (
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
                    {e.serviceName} · {formatTime(e.desiredStartAt)}
                    {showSpecialist ? ` · ${e.specialistName}` : ''}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!showAll && preferred.length > 0 && preferred.length < ranked.length ? (
          <button
            type="button"
            className="text-xs text-fitgo-300 underline"
            onClick={() => setShowAll(true)}
          >
            Показать весь лист дня ({ranked.length})
          </button>
        ) : null}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="btn-primary w-full"
            disabled={busy || !selectedId}
            onClick={() => {
              const entry = list.find((e) => e.id === selectedId);
              if (!entry) return;
              void onBook(entry);
            }}
          >
            Записать выбранного
          </button>
          {onNewBooking ? (
            <button
              type="button"
              className="btn-secondary w-full"
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
