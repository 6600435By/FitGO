'use client';

import type { PayrollAdjustmentDto } from '@fitgo/shared-types';
import { money } from '@/components/payroll/employee-report/work-unit-status';

type Props = {
  canEdit: boolean;
  currency: string;
  adjustments: PayrollAdjustmentDto[];
  adjAmount: string;
  adjReason: string;
  editingAdjId: string | null;
  onAmount: (v: string) => void;
  onReason: (v: string) => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onStartEdit: (a: PayrollAdjustmentDto) => void;
  onDelete: (id: string) => void;
};

export function AdjustmentsTab({
  canEdit,
  currency,
  adjustments,
  adjAmount,
  adjReason,
  editingAdjId,
  onAmount,
  onReason,
  onSave,
  onCancelEdit,
  onStartEdit,
  onDelete,
}: Props) {
  return (
    <div className="space-y-3">
      {canEdit ? (
        <section className="space-y-3 rounded-xl border border-slate-800 p-3 md:flex md:items-end md:gap-3 md:space-y-0">
          <div className="space-y-1 md:flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {editingAdjId ? 'Редактировать корректировку' : 'Премия / штраф'}
            </p>
            <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
              <input
                className="input"
                inputMode="decimal"
                placeholder="± BYN"
                value={adjAmount}
                onChange={(e) => onAmount(e.target.value)}
              />
              <input
                className="input"
                placeholder="Причина"
                value={adjReason}
                onChange={(e) => onReason(e.target.value)}
              />
            </div>
          </div>
          <div className="flex w-full gap-2 md:w-auto">
            <button
              type="button"
              className="btn-secondary flex-1 md:flex-none"
              onClick={onSave}
            >
              {editingAdjId ? 'Сохранить' : 'Добавить'}
            </button>
            {editingAdjId ? (
              <button
                type="button"
                className="btn-secondary flex-1 md:flex-none"
                onClick={onCancelEdit}
              >
                Отмена
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {adjustments.length === 0 ? (
        <p className="text-sm text-slate-500">Нет премий и штрафов за период</p>
      ) : (
        <ul className="space-y-1 rounded-xl border border-slate-800 p-3 text-sm">
          {adjustments.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-900/80 py-2 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <span className="text-slate-400">{a.reason}</span>
                <span
                  className={`ml-2 tabular-nums ${
                    a.amountMinor >= 0 ? 'text-emerald-400' : 'text-red-300'
                  }`}
                >
                  {money(a.amountMinor, currency)}
                </span>
              </div>
              {canEdit ? (
                <div className="flex gap-3 text-xs">
                  <button
                    type="button"
                    className="text-sky-300"
                    onClick={() => onStartEdit(a)}
                  >
                    Изменить
                  </button>
                  <button
                    type="button"
                    className="text-red-300"
                    onClick={() => onDelete(a.id)}
                  >
                    Удалить
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
