'use client';

import type { AdminTaskOutcomeDef } from '@fitgo/shared-types';
import { useState } from 'react';

export function TaskOutcomeSheet({
  title,
  outcomes,
  onClose,
  onSubmit,
}: {
  title: string;
  outcomes: AdminTaskOutcomeDef[];
  onClose: () => void;
  onSubmit: (opts: {
    outcome: AdminTaskOutcomeDef;
    comment?: string;
    date?: string;
  }) => void | Promise<void>;
}) {
  const [picked, setPicked] = useState<AdminTaskOutcomeDef | null>(null);
  const [comment, setComment] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const needsExtra =
    picked && (picked.needsComment || picked.needsDate);

  const confirm = async (outcome: AdminTaskOutcomeDef) => {
    if (outcome.needsComment && !comment.trim()) {
      setError('Укажите комментарий');
      return;
    }
    if (outcome.needsDate && !date) {
      setError('Укажите дату');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit({
        outcome,
        comment: comment.trim() || undefined,
        date: date || undefined,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="card w-full max-w-md space-y-3 !p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold">Исход</h3>
            <p className="text-sm text-slate-400">{title}</p>
          </div>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={onClose}
          >
            Закрыть
          </button>
        </div>

        {!picked || !needsExtra ? (
          <div className="grid gap-2">
            {outcomes.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={busy}
                className="btn-secondary w-full justify-center text-sm"
                onClick={() => {
                  if (o.needsComment || o.needsDate) {
                    setPicked(o);
                    setError('');
                  } else {
                    void confirm(o);
                  }
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">{picked.label}</p>
            {picked.needsDate ? (
              <input
                type="date"
                className="input w-full"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            ) : null}
            {picked.needsComment ? (
              <textarea
                className="input w-full"
                rows={3}
                placeholder="Комментарий"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            ) : null}
            {error ? <p className="text-sm text-rose-400">{error}</p> : null}
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary flex-1 text-sm"
                disabled={busy}
                onClick={() => void confirm(picked)}
              >
                Подтвердить
              </button>
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => {
                  setPicked(null);
                  setError('');
                }}
              >
                Назад
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
