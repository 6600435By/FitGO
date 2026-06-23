'use client';

import type { ScheduleTypeFilter } from './calendar-utils';

const OPTIONS: Array<{ value: ScheduleTypeFilter; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'group', label: 'Групповые' },
  { value: 'personal', label: 'Персональные' },
];

export function ScheduleTypeFilterBar({
  value,
  onChange,
}: {
  value: ScheduleTypeFilter;
  onChange: (value: ScheduleTypeFilter) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-full px-3 py-1.5 text-sm transition ${
            value === option.value
              ? 'bg-fitgo-500 text-white'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
