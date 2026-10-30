'use client';

import type { DecayWarning } from '@fitgo/shared-types';

export function RatingDecayBanner({
  warning,
  onDailyGoal,
  loading,
}: {
  warning: DecayWarning;
  onDailyGoal?: () => void;
  loading?: boolean;
}) {
  const colors = {
    info: 'border-slate-600 bg-slate-800/50',
    warning: 'border-yellow-600/50 bg-yellow-500/10',
    critical: 'border-red-600/50 bg-red-500/10',
  };

  return (
    <div className={`card border ${colors[warning.urgency]}`}>
      <p className="font-medium">{warning.message}</p>
      <p className="mt-1 text-sm text-slate-400">
        День {warning.dayOfMonth} · до конца месяца {warning.daysLeftInMonth} дн.
      </p>
      {onDailyGoal && (
        <button
          type="button"
          onClick={onDailyGoal}
          disabled={loading}
          className="btn-primary mt-3 w-full"
        >
          {loading ? '...' : 'Выполнить ежедневную цель (+5 XP)'}
        </button>
      )}
    </div>
  );
}
