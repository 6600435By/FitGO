'use client';

import type { WorkoutSessionSummary } from '@fitgo/shared-types';

const SEGMENT_COLORS: Record<string, string> = {
  warmup: 'bg-slate-500',
  strength: 'bg-fitgo-500',
  cardio: 'bg-rose-500',
  circuit: 'bg-amber-500',
  mobility: 'bg-violet-500',
  cooldown: 'bg-slate-600',
};

interface WorkoutSessionSummaryPanelProps {
  summary: WorkoutSessionSummary;
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl bg-slate-800/50 p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-slate-100">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}

function BarChart({
  title,
  items,
  maxValue,
  colorClass = 'bg-fitgo-500/80',
  formatValue,
}: {
  title: string;
  items: Array<{ label: string; value: number }>;
  maxValue?: number;
  colorClass?: string;
  formatValue?: (v: number) => string;
}) {
  if (items.length === 0) return null;
  const max = maxValue ?? Math.max(10, ...items.map((i) => i.value));

  return (
    <div>
      {title ? (
        <p className="mb-2 text-xs uppercase text-slate-500">{title}</p>
      ) : null}
      <div className="flex items-end gap-2 h-28">
        {items.map((item) => {
          const height = `${Math.max(4, (item.value / max) * 100)}%`;
          return (
            <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="text-[10px] font-medium text-slate-300">
                {formatValue ? formatValue(item.value) : item.value}
              </span>
              <div className="flex h-20 w-full items-end justify-center">
                <div
                  className={`w-full max-w-[36px] rounded-t ${colorClass}`}
                  style={{ height }}
                  title={`${item.label}: ${item.value}`}
                />
              </div>
              <span className="max-w-full truncate text-center text-[10px] text-slate-500">
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function WorkoutSessionSummaryPanel({ summary }: WorkoutSessionSummaryPanelProps) {
  if (!summary.hasData) {
    return (
      <p className="text-sm text-slate-500">
        Сводка появится после заполнения блоков тренировки и показателей сессии.
      </p>
    );
  }

  const durationTotal =
    summary.totalDurationMin ??
    summary.durationSegments.reduce((sum, s) => sum + s.min, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {durationTotal > 0 && (
          <StatCard label="Время блоков" value={`${durationTotal} мин`} hint="сумма по FITT" />
        )}
        {summary.strength?.tonnageKg != null && (
          <StatCard
            label="Объём силовой"
            value={`${summary.strength.tonnageKg}`}
            hint="кг × повторы"
          />
        )}
        {summary.strength?.totalSets != null && summary.strength.totalSets > 0 && (
          <StatCard label="Подходы" value={String(summary.strength.totalSets)} />
        )}
        {summary.sessionRpe != null && (
          <StatCard
            label="RPE сессии"
            value={String(summary.sessionRpe)}
            hint="Feel / TrainingPeaks"
          />
        )}
        {summary.restingHr != null && (
          <StatCard label="ЧСС покой" value={`${summary.restingHr}`} hint="уд/мин" />
        )}
        {summary.maxHr != null && (
          <StatCard
            label="Макс. ЧСС"
            value={`${summary.maxHr}`}
            hint={summary.maxHrPct ? `${summary.maxHrPct}% от макс.` : undefined}
          />
        )}
        {summary.circuit?.scoreLabel && (
          <StatCard
            label="WOD"
            value={summary.circuit.scoreLabel}
            hint={summary.circuit.formatLabel}
          />
        )}
      </div>

      {summary.durationSegments.length > 1 && durationTotal > 0 && (
        <div>
          <p className="mb-2 text-xs uppercase text-slate-500">
            Структура по времени (Polar / Garmin)
          </p>
          <div className="flex h-3 overflow-hidden rounded-full bg-slate-800">
            {summary.durationSegments.map((segment) => (
              <div
                key={segment.id}
                className={`${SEGMENT_COLORS[segment.id] ?? 'bg-slate-500'} transition-all`}
                style={{ width: `${(segment.min / durationTotal) * 100}%` }}
                title={`${segment.label}: ${segment.min} мин`}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
            {summary.blocks
              .filter((b) => b.durationMin)
              .map((block) => (
                <span key={block.id} className="flex items-center gap-1">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${SEGMENT_COLORS[block.id] ?? 'bg-slate-500'}`}
                  />
                  {block.label} {block.durationMin} мин
                  {block.durationSharePct != null ? ` (${block.durationSharePct}%)` : ''}
                </span>
              ))}
          </div>
        </div>
      )}

      <BarChart title="RPE по блокам" items={summary.rpeBars} maxValue={10} />

      {summary.strength && summary.strength.exercises.length > 0 && (
        <div>
          <p className="mb-2 text-xs uppercase text-slate-500">Силовая — по упражнениям</p>
          <BarChart
            title=""
            items={summary.strength.exercises
              .filter((e) => e.avgRpe != null)
              .map((e) => ({
                label: e.name.length > 12 ? `${e.name.slice(0, 11)}…` : e.name,
                value: e.avgRpe!,
              }))}
            maxValue={10}
            colorClass="bg-emerald-500/80"
          />
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[320px] text-xs">
              <thead>
                <tr className="border-b border-slate-700 text-left text-slate-500">
                  <th className="py-2 pr-2">Упражнение</th>
                  <th className="py-2 pr-2">Подх.</th>
                  <th className="py-2 pr-2">Топ</th>
                  <th className="py-2">RPE</th>
                </tr>
              </thead>
              <tbody>
                {summary.strength.exercises.map((row) => (
                  <tr key={row.name} className="border-b border-slate-800/60">
                    <td className="py-2 pr-2 font-medium text-slate-200">{row.name}</td>
                    <td className="py-2 pr-2">{row.workingSets}</td>
                    <td className="py-2 pr-2">{row.topLoad ?? '—'}</td>
                    <td className="py-2">
                      {row.avgRpe ?? '—'}
                      {row.maxRpe && row.maxRpe !== row.avgRpe ? ` (макс ${row.maxRpe})` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {summary.circuit && summary.circuit.rounds.some((r) => r.workSec || r.avgHr) && (
        <div>
          <p className="mb-2 text-xs uppercase text-slate-500">Круговая — время кругов</p>
          <BarChart
            title=""
            items={summary.circuit.rounds
              .filter((r) => r.workSec)
              .map((r) => ({
                label: `Кр.${r.round}`,
                value: r.workSec!,
              }))}
            colorClass="bg-amber-500/80"
            formatValue={(v) => `${v}с`}
          />
          {summary.circuit.avgHr != null && (
            <p className="mt-1 text-xs text-slate-500">
              Ср. ЧСС круга: {summary.circuit.avgHr}
              {summary.circuit.maxHr ? ` · макс ${summary.circuit.maxHr}` : ''}
            </p>
          )}
        </div>
      )}

      {summary.cardio && summary.cardio.rows > 0 && (
        <div className="rounded-xl bg-slate-800/40 p-3 text-sm">
          <p className="font-medium text-slate-200">Кардио</p>
          <p className="mt-1 text-slate-400">
            {summary.cardio.rows} {summary.cardio.rows === 1 ? 'отрезок' : 'отрезка'}
            {summary.cardio.avgHr ? ` · ЧСС ${summary.cardio.avgHr}` : ''}
            {summary.cardio.avgRpe ? ` · RPE ${summary.cardio.avgRpe}` : ''}
            {summary.cardio.topZone ? ` · ${summary.cardio.topZone}` : ''}
          </p>
        </div>
      )}

      {summary.mobility && summary.mobility.exercises > 0 && (
        <div className="rounded-xl bg-slate-800/40 p-3 text-sm">
          <p className="font-medium text-slate-200">Биомеханика</p>
          <p className="mt-1 text-slate-400">
            {summary.mobility.exercises} упр.
            {summary.mobility.avgRpe ? ` · RPE ${summary.mobility.avgRpe}` : ''}
            {summary.mobility.avgComfort
              ? ` · самочувствие ${summary.mobility.avgComfort}/10`
              : ''}
          </p>
        </div>
      )}

      {summary.blocks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {summary.blocks.map((block) => (
            <div
              key={block.id}
              className="rounded-lg border border-slate-700/80 bg-slate-800/30 px-2.5 py-1.5 text-xs"
            >
              <span className="font-medium text-slate-200">{block.label}</span>
              {block.highlights.length > 0 && (
                <span className="text-slate-500"> · {block.highlights.join(' · ')}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
