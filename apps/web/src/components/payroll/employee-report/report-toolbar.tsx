'use client';

import type { StaffPaySummary } from '@fitgo/shared-types';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { DateField } from '@/components/ui/date-field';

export type DeptFilter =
  | 'ALL'
  | 'MANAGER'
  | 'ADMIN'
  | 'TRAINER'
  | 'SPECIALIST'
  | 'TECH'
  | 'EXTERNAL';

export const DEPT_FILTERS: { id: DeptFilter; label: string }[] = [
  { id: 'ALL', label: 'Все' },
  { id: 'MANAGER', label: 'Упр.' },
  { id: 'ADMIN', label: 'Админы' },
  { id: 'TRAINER', label: 'Тренеры' },
  { id: 'SPECIALIST', label: 'SPA' },
  { id: 'TECH', label: 'Техперсонал' },
  { id: 'EXTERNAL', label: 'Сторонние' },
];

export type PeriodPreset =
  | 'thisMonth'
  | 'lastMonth'
  | 'firstHalf'
  | 'secondHalf';

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function periodPresetRange(
  preset: PeriodPreset,
  today = new Date(),
): { from: string; to: string } {
  if (preset === 'thisMonth') {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: isoDate(from), to: isoDate(today) };
  }
  if (preset === 'lastMonth') {
    const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const to = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: isoDate(from), to: isoDate(to) };
  }
  if (preset === 'firstHalf') {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    const to = new Date(today.getFullYear(), today.getMonth(), 15);
    const end = to > today ? today : to;
    return { from: isoDate(from), to: isoDate(end) };
  }
  // 16–конец: current month if past the 15th, else previous month
  if (today.getDate() < 16) {
    const from = new Date(today.getFullYear(), today.getMonth() - 1, 16);
    const to = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: isoDate(from), to: isoDate(to) };
  }
  const from = new Date(today.getFullYear(), today.getMonth(), 16);
  return { from: isoDate(from), to: isoDate(today) };
}

const PRESETS: { id: PeriodPreset; label: string }[] = [
  { id: 'thisMonth', label: 'Этот месяц' },
  { id: 'lastMonth', label: 'Прошлый' },
  { id: 'firstHalf', label: '1–15' },
  { id: 'secondHalf', label: '16–конец' },
];

type Props = {
  canEdit: boolean;
  deptFilter: DeptFilter;
  onDeptFilter: (d: DeptFilter) => void;
  filteredStaff: StaffPaySummary[];
  reportUserId: string;
  onUserId: (id: string) => void;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onPreset: (p: PeriodPreset) => void;
  loading: boolean;
  syncing1c: boolean;
  onRecalc: () => void;
  onRefresh1c: () => void;
  onPrint: () => void;
  printBusy?: boolean;
};

export function ReportToolbar({
  canEdit,
  deptFilter,
  onDeptFilter,
  filteredStaff,
  reportUserId,
  onUserId,
  from,
  to,
  onFrom,
  onTo,
  onPreset,
  loading,
  syncing1c,
  onRecalc,
  onRefresh1c,
  onPrint,
  printBusy,
}: Props) {
  const idx = filteredStaff.findIndex((s) => s.userId === reportUserId);
  const selected = idx >= 0 ? filteredStaff[idx] : undefined;

  const goPrev = () => {
    if (idx <= 0) return;
    onUserId(filteredStaff[idx - 1]!.userId);
  };
  const goNext = () => {
    if (idx < 0 || idx >= filteredStaff.length - 1) return;
    onUserId(filteredStaff[idx + 1]!.userId);
  };

  return (
    <div className="sticky top-0 z-10 space-y-2 rounded-xl border border-slate-800 bg-slate-950/95 p-2.5 backdrop-blur-sm md:p-3">
      <div className="flex flex-wrap items-end gap-2">
        {canEdit ? (
          <>
            <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              <span>Отдел</span>
              <select
                className="input w-[8.5rem] py-1.5 text-sm"
                value={deptFilter}
                onChange={(e) => onDeptFilter(e.target.value as DeptFilter)}
              >
                {DEPT_FILTERS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex min-w-[14rem] flex-1 items-end gap-1">
              <button
                type="button"
                className="btn-secondary mb-0 flex h-[2.125rem] w-8 shrink-0 items-center justify-center px-0"
                disabled={idx <= 0}
                onClick={goPrev}
                title="Предыдущий сотрудник"
                aria-label="Предыдущий сотрудник"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                <span>Сотрудник</span>
                <select
                  className="input w-full min-w-[10rem] py-1.5 text-sm"
                  value={reportUserId}
                  onChange={(e) => onUserId(e.target.value)}
                >
                  {filteredStaff.length === 0 ? (
                    <option value="">Нет сотрудников в фильтре</option>
                  ) : (
                    filteredStaff.map((s) => (
                      <option key={s.userId} value={s.userId}>
                        {s.name}
                        {s.track ? ` · ${s.track}` : ''}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <button
                type="button"
                className="btn-secondary mb-0 flex h-[2.125rem] w-8 shrink-0 items-center justify-center px-0"
                disabled={idx < 0 || idx >= filteredStaff.length - 1}
                onClick={goNext}
                title="Следующий сотрудник"
                aria-label="Следующий сотрудник"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </>
        ) : (
          <div className="min-w-[12rem] flex-1 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Моя ЗП
            </p>
            <p className="mt-0.5 font-medium text-white">
              {selected?.name ?? '…'}
            </p>
          </div>
        )}

        <DateField
          label="С"
          value={from}
          onChange={onFrom}
          className="w-[9.5rem]"
          inputClassName="text-sm"
        />
        <DateField
          label="По"
          value={to}
          onChange={onTo}
          className="w-[9.5rem]"
          inputClassName="text-sm"
        />

        <button
          type="button"
          className="btn-primary px-3 py-1.5 text-sm"
          disabled={loading || !reportUserId}
          onClick={onRecalc}
        >
          {loading ? 'Считаем…' : 'Пересчитать'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="rounded-md border border-slate-700/80 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-600 hover:text-white"
            onClick={() => onPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
        <span className="mx-1 hidden h-4 w-px bg-slate-800 sm:inline" />
        <button
          type="button"
          className="btn-secondary px-2.5 py-1 text-xs"
          disabled={syncing1c || loading || !reportUserId}
          onClick={onRefresh1c}
          title="Перечитать занятия из 1С за выбранный период и пересчитать"
        >
          {syncing1c ? 'Обновляем…' : 'Обновить из 1С'}
        </button>
        {canEdit && (
          <button
            type="button"
            className="btn-secondary px-2.5 py-1 text-xs"
            disabled={printBusy || !reportUserId}
            onClick={onPrint}
          >
            {printBusy ? 'Печать…' : 'Печать листка'}
          </button>
        )}
        {canEdit && selected && (
          <Link
            href={`/super-admin/staff/${selected.userId}`}
            className="px-2 py-1 text-xs text-fitgo-400 hover:underline"
          >
            Ставки
          </Link>
        )}
      </div>
    </div>
  );
}
