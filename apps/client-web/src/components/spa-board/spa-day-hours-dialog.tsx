'use client';

import { normalizeHm } from '@/components/spa-board/spa-hours-editor';

const DEFAULT_START = '10:00';
const DEFAULT_END = '20:00';

export function SpaDayHoursDialog({
  open,
  dayLabel,
  initialStart,
  initialEnd,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  dayLabel: string;
  initialStart?: string | null;
  initialEnd?: string | null;
  busy?: boolean;
  onClose: () => void;
  onSave: (value: {
    startTime: string | null;
    endTime: string | null;
  }) => void;
}) {
  if (!open) return null;

  const hasInitial = Boolean(initialStart && initialEnd);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <form
        className="card w-full max-w-md space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const off = fd.get('dayOff') === 'on';
          if (off) {
            onSave({ startTime: null, endTime: null });
            return;
          }
          const startTime = normalizeHm(String(fd.get('startTime') ?? ''));
          const endTime = normalizeHm(String(fd.get('endTime') ?? ''));
          onSave({ startTime, endTime });
        }}
      >
        <div>
          <h3 className="font-medium">Часы на день</h3>
          <p className="mt-1 text-sm text-slate-400">{dayLabel}</p>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            name="dayOff"
            defaultChecked={!hasInitial}
            onChange={(e) => {
              const form = e.currentTarget.form;
              if (!form) return;
              const disabled = e.currentTarget.checked;
              const start = form.elements.namedItem(
                'startTime',
              ) as HTMLInputElement | null;
              const end = form.elements.namedItem(
                'endTime',
              ) as HTMLInputElement | null;
              if (start) start.disabled = disabled;
              if (end) end.disabled = disabled;
            }}
          />
          Выходной (без рабочих часов)
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="time"
            name="startTime"
            className="input w-[6.5rem] px-2 text-sm"
            defaultValue={initialStart ?? DEFAULT_START}
            disabled={!hasInitial}
          />
          <span className="text-slate-500">–</span>
          <input
            type="time"
            name="endTime"
            className="input w-[6.5rem] px-2 text-sm"
            defaultValue={initialEnd ?? DEFAULT_END}
            disabled={!hasInitial}
          />
        </div>

        <p className="text-xs text-slate-500">
          Меняет только этот день на доске. Шаблон недели не трогает.
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary flex-1"
            disabled={busy}
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            type="submit"
            className="btn-primary flex-1"
            disabled={busy}
          >
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </div>
  );
}
