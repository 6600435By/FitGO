'use client';

import type { WorkoutSessionSummary } from '@fitgo/shared-types';

/** Короткая полоска факта — только если уже есть цифры. */
export function WorkoutSessionFactStrip({
  summary,
}: {
  summary: WorkoutSessionSummary;
}) {
  if (!summary.hasData) return null;

  const durationTotal =
    summary.totalDurationMin ??
    summary.durationSegments.reduce((sum, s) => sum + s.min, 0);

  const items: Array<{ label: string; value: string }> = [];
  if (durationTotal > 0) {
    items.push({ label: 'Время', value: `${durationTotal} мин` });
  }
  if (summary.strength?.tonnageKg != null) {
    items.push({
      label: 'Объём',
      value: `${summary.strength.tonnageKg} кг`,
    });
  }
  if (summary.strength?.totalSets != null && summary.strength.totalSets > 0) {
    items.push({ label: 'Подходы', value: String(summary.strength.totalSets) });
  }
  if (summary.sessionRpe != null) {
    items.push({ label: 'RPE', value: String(summary.sessionRpe) });
  }
  if (summary.maxHr != null) {
    items.push({ label: 'ЧСС', value: String(summary.maxHr) });
  }

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-2xl border border-white/10 bg-ink-raised/60 px-3 py-2"
        >
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">
            {item.label}
          </p>
          <p className="font-display text-sm font-semibold tabular-nums text-white">
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}
