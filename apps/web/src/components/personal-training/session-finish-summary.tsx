'use client';

import { ResponsiveSheet } from '@fitgo/forma-ui';
import type { WorkoutSheet } from '@fitgo/shared-types';
import { getWorkoutBlocks, WORKOUT_SECTION_LABELS } from '@fitgo/shared-types';
import { useMemo, useState } from 'react';

function formatDuration(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h} ч ${m % 60} мин`;
  }
  return s > 0 ? `${m} мин ${s} с` : `${m} мин`;
}

export function SessionFinishSummary({
  open,
  onOpenChange,
  sheet,
  elapsedMs,
  clientNotes,
  privateNotes,
  homeworkDraft,
  onChangeRpe,
  onSend,
  busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sheet: WorkoutSheet;
  elapsedMs: number;
  clientNotes: string;
  privateNotes: string;
  homeworkDraft: string;
  onChangeRpe: (rpe: number) => void;
  onSend: () => void | Promise<void>;
  busy?: boolean;
}) {
  const [rpe, setRpe] = useState(sheet.sessionRpe ?? 6);
  const blocks = useMemo(() => getWorkoutBlocks(sheet), [sheet]);

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Итог тренировки"
      description="Проверьте заметки и отправьте клиенту"
      desktop="dialog"
    >
      <div className="space-y-5 pb-4">
        <div className="rounded-2xl border border-white/10 bg-ink-raised/60 p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            Длительность
          </p>
          <p className="mt-1 font-display text-2xl font-semibold text-white">
            {formatDuration(elapsedMs)}
          </p>
          {blocks.length > 0 ? (
            <p className="mt-2 text-sm text-zinc-400">
              Блоки:{' '}
              {blocks
                .map((b) => WORKOUT_SECTION_LABELS[b] ?? b)
                .join(' · ')}
            </p>
          ) : null}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-zinc-200">
              RPE клиента (1–10)
            </p>
            <span className="font-display text-xl font-semibold text-forma-400">
              {rpe}
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={rpe}
            onChange={(e) => {
              const v = Number(e.target.value);
              setRpe(v);
              onChangeRpe(v);
            }}
            className="w-full accent-[#ffd000]"
          />
          <div className="mt-1 flex justify-between text-[10px] text-zinc-600">
            <span>легко</span>
            <span>очень тяжело</span>
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <div className="rounded-2xl border border-white/10 px-3 py-2">
            <p className="text-xs text-zinc-500">Для клиента</p>
            <p className="mt-1 whitespace-pre-wrap text-zinc-200">
              {clientNotes.trim() || '—'}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 px-3 py-2">
            <p className="text-xs text-zinc-500">Для себя</p>
            <p className="mt-1 whitespace-pre-wrap text-zinc-400">
              {privateNotes.trim() || '—'}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 px-3 py-2">
            <p className="text-xs text-zinc-500">Задание</p>
            <p className="mt-1 whitespace-pre-wrap text-zinc-200">
              {homeworkDraft.trim() || '—'}
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void onSend()}
          className="btn-primary w-full disabled:opacity-50"
        >
          {busy ? 'Отправка…' : 'Отправить клиенту и завершить'}
        </button>
      </div>
    </ResponsiveSheet>
  );
}
