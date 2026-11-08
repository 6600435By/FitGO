'use client';

import type {
  PrepActivityRow,
  WorkoutSectionId,
  WorkoutSheet,
} from '@fitgo/shared-types';
import {
  CARDIO_DEFAULT_FIELDS,
  COOLDOWN_DEFAULT_FIELDS,
  MOBILITY_DEFAULT_FIELDS,
  WARMUP_DEFAULT_FIELDS,
  WORKOUT_SECTION_LABELS,
  completeWorkoutSection,
  getSectionDurationMin,
  getSessionSectionIds,
  prepRowHasData,
  saveBlockSummary,
} from '@fitgo/shared-types';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { LiveExerciseCard, hasLiveStrengthExercises } from './live-exercise-card';

function PrepLiveRows({
  rows,
  onToggle,
}: {
  rows: PrepActivityRow[];
  onToggle: (index: number) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-center text-sm text-zinc-500">
        Движения не заданы — ведите по времени блока
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row, i) => {
        const done = Boolean(row.skipped) || Boolean(row.actualWorkSec);
        return (
          <button
            key={i}
            type="button"
            onClick={() => onToggle(i)}
            className={cn(
              'flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left',
              done
                ? 'border-forma-500/30 bg-forma-500/10'
                : 'border-white/10 bg-ink-raised/60',
            )}
          >
            <span
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                done
                  ? 'bg-forma-500 text-ink'
                  : 'border border-white/15 text-zinc-400',
              )}
            >
              <Check className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-white">
                {row.type?.trim() || `Этап ${i + 1}`}
              </span>
              <span className="text-xs text-zinc-500">
                {[row.duration, row.zone, row.rpe ? `RPE ${row.rpe}` : '']
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function markSectionDone(
  sheet: WorkoutSheet,
  sectionId: WorkoutSectionId,
): WorkoutSheet {
  let next = completeWorkoutSection(sheet, sectionId);
  next = saveBlockSummary(next, sectionId);
  return next;
}

export function LiveBlockCard({
  sheet,
  sectionId,
  onChangeSheet,
  onSetCompleted,
  onAdvance,
}: {
  sheet: WorkoutSheet;
  sectionId: WorkoutSectionId;
  onChangeSheet: (next: WorkoutSheet) => void;
  onSetCompleted?: (restSec: number | undefined) => void;
  onAdvance?: () => void;
}) {
  const [mobilityIndex, setMobilityIndex] = useState(0);
  const [stationIndex, setStationIndex] = useState(0);

  const duration = getSectionDurationMin(sheet, sectionId);
  const done = Boolean(sheet.blockProgress?.[sectionId]?.summarySaved);

  const mobilityRows = useMemo(() => {
    const fields = sheet.mobilityFields ?? MOBILITY_DEFAULT_FIELDS;
    return (sheet.mobilityExercises ?? []).filter(
      (r) => r.name?.trim() || fields.some((f) => Boolean(r[f]?.trim())),
    );
  }, [sheet.mobilityExercises, sheet.mobilityFields]);

  const stations = sheet.circuit?.stations ?? [];

  if (sectionId === 'strength') {
    return (
      <LiveExerciseCard
        sheet={sheet}
        onChangeSheet={onChangeSheet}
        onSetCompleted={onSetCompleted}
      />
    );
  }

  if (sectionId === 'warmup' || sectionId === 'cooldown') {
    const activities =
      sectionId === 'warmup'
        ? (sheet.warmupActivities ?? [])
        : (sheet.cooldownActivities ?? []);
    const fields =
      sectionId === 'warmup'
        ? (sheet.warmupFields ?? WARMUP_DEFAULT_FIELDS)
        : (sheet.cooldownFields ?? COOLDOWN_DEFAULT_FIELDS);
    const rows = activities.filter((r) => prepRowHasData(r, fields));

    const toggle = (index: number) => {
      const source =
        sectionId === 'warmup'
          ? (sheet.warmupActivities ?? [])
          : (sheet.cooldownActivities ?? []);
      let seen = -1;
      const next = source.map((row) => {
        if (!prepRowHasData(row, fields)) return row;
        seen += 1;
        if (seen !== index) return row;
        if (row.actualWorkSec || row.skipped) {
          return { ...row, actualWorkSec: undefined, skipped: undefined };
        }
        return { ...row, actualWorkSec: 60 };
      });
      onChangeSheet(
        sectionId === 'warmup'
          ? { ...sheet, warmupActivities: next }
          : { ...sheet, cooldownActivities: next },
      );
    };

    return (
      <div className="mx-auto w-full max-w-md space-y-3">
        <div className="text-center">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">
            {WORKOUT_SECTION_LABELS[sectionId]}
            {duration ? ` · ${duration} мин` : ''}
          </p>
          <p className="font-display text-lg font-semibold text-white">
            {done ? 'Готово' : 'Текущий блок'}
          </p>
        </div>
        <PrepLiveRows rows={rows} onToggle={toggle} />
        {!done ? (
          <button
            type="button"
            onClick={() => {
              onChangeSheet(markSectionDone(sheet, sectionId));
              onAdvance?.();
            }}
            className="w-full rounded-2xl bg-forma-500 py-2.5 text-sm font-semibold text-ink"
          >
            Дальше
          </button>
        ) : null}
      </div>
    );
  }

  if (sectionId === 'cardio') {
    const fields = sheet.cardioFields ?? CARDIO_DEFAULT_FIELDS;
    const rows = (sheet.cardioExercises ?? []).filter((r) =>
      fields.some((f) => Boolean(r[f]?.trim())),
    );
    const row = rows[0];
    const rowIndex = row ? sheet.cardioExercises.indexOf(row) : -1;

    const patchActual = (
      key: 'actualHr' | 'actualRpe' | 'actualZone' | 'duration',
      value: string,
    ) => {
      if (rowIndex < 0) return;
      const next = sheet.cardioExercises.map((r, i) =>
        i === rowIndex ? { ...r, [key]: value } : r,
      );
      onChangeSheet({ ...sheet, cardioExercises: next });
    };

    return (
      <div className="mx-auto w-full max-w-md space-y-3">
        <div className="text-center">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">
            Кардио{duration ? ` · ${duration} мин` : ''}
          </p>
          <p className="font-display text-lg font-semibold text-white">
            {row?.modality?.trim() || 'Кардио'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {fields.includes('duration') ? (
            <label className="rounded-2xl border border-white/10 bg-ink-raised/60 px-3 py-2">
              <span className="text-[10px] uppercase text-zinc-500">Время</span>
              <input
                className="mt-1 w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
                placeholder="мин"
                value={row?.duration ?? ''}
                onChange={(e) => patchActual('duration', e.target.value)}
              />
            </label>
          ) : null}
          {fields.includes('zone') ? (
            <label className="rounded-2xl border border-white/10 bg-ink-raised/60 px-3 py-2">
              <span className="text-[10px] uppercase text-zinc-500">Зона</span>
              <input
                className="mt-1 w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
                placeholder="Z2"
                value={row?.actualZone ?? row?.zone ?? ''}
                onChange={(e) => patchActual('actualZone', e.target.value)}
              />
            </label>
          ) : null}
          {fields.includes('hr') ? (
            <label className="rounded-2xl border border-white/10 bg-ink-raised/60 px-3 py-2">
              <span className="text-[10px] uppercase text-zinc-500">ЧСС</span>
              <input
                className="mt-1 w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
                inputMode="numeric"
                placeholder="уд/мин"
                value={row?.actualHr ?? row?.hr ?? ''}
                onChange={(e) => patchActual('actualHr', e.target.value)}
              />
            </label>
          ) : null}
          {fields.includes('rpe') ? (
            <label className="rounded-2xl border border-white/10 bg-ink-raised/60 px-3 py-2">
              <span className="text-[10px] uppercase text-zinc-500">RPE</span>
              <input
                className="mt-1 w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
                inputMode="numeric"
                placeholder="1–10"
                value={row?.actualRpe ?? row?.rpe ?? ''}
                onChange={(e) => patchActual('actualRpe', e.target.value)}
              />
            </label>
          ) : null}
        </div>
        {!done ? (
          <button
            type="button"
            onClick={() => {
              onChangeSheet(markSectionDone(sheet, sectionId));
              onAdvance?.();
            }}
            className="w-full rounded-2xl bg-forma-500 py-2.5 text-sm font-semibold text-ink"
          >
            Дальше
          </button>
        ) : null}
      </div>
    );
  }

  if (sectionId === 'mobility') {
    const safe = Math.min(mobilityIndex, Math.max(0, mobilityRows.length - 1));
    const row = mobilityRows[safe];

    return (
      <div className="mx-auto w-full max-w-md space-y-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={safe <= 0}
            onClick={() => setMobilityIndex((i) => Math.max(0, i - 1))}
            className="rounded-full border border-white/10 p-2 text-zinc-300 disabled:opacity-30"
            aria-label="Назад"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">
              Биомеханика{' '}
              {mobilityRows.length ? `${safe + 1}/${mobilityRows.length}` : ''}
            </p>
            <p className="truncate font-display text-lg font-semibold text-white">
              {row?.name?.trim() || row?.focusArea?.trim() || 'Упражнение'}
            </p>
          </div>
          <button
            type="button"
            disabled={safe >= mobilityRows.length - 1}
            onClick={() =>
              setMobilityIndex((i) =>
                Math.min(mobilityRows.length - 1, i + 1),
              )
            }
            className="rounded-full border border-white/10 p-2 text-zinc-300 disabled:opacity-30"
            aria-label="Вперёд"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        {row ? (
          <div className="rounded-2xl border border-white/10 bg-ink-raised/60 px-3 py-3 text-sm text-zinc-300">
            {[
              row.duration,
              row.volume,
              row.comfort ? `самоч. ${row.comfort}` : '',
            ]
              .filter(Boolean)
              .join(' · ') || '—'}
          </div>
        ) : (
          <p className="text-center text-sm text-zinc-500">Пусто</p>
        )}
        {!done ? (
          <button
            type="button"
            onClick={() => {
              onChangeSheet(markSectionDone(sheet, sectionId));
              onAdvance?.();
            }}
            className="w-full rounded-2xl bg-forma-500 py-2.5 text-sm font-semibold text-ink"
          >
            Дальше
          </button>
        ) : null}
      </div>
    );
  }

  if (sectionId === 'circuit' && sheet.circuit) {
    const safe = Math.min(stationIndex, Math.max(0, stations.length - 1));
    const station = stations[safe];

    return (
      <div className="mx-auto w-full max-w-md space-y-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={safe <= 0}
            onClick={() => setStationIndex((i) => Math.max(0, i - 1))}
            className="rounded-full border border-white/10 p-2 text-zinc-300 disabled:opacity-30"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">
              Круговая · станция {safe + 1}/{stations.length || 1}
            </p>
            <p className="truncate font-display text-lg font-semibold text-white">
              {station?.name?.trim() || `Станция ${safe + 1}`}
            </p>
            <p className="text-xs text-zinc-500">
              {[
                station?.workSec != null ? `${station.workSec} с работа` : '',
                station?.restSec != null ? `${station.restSec} с отдых` : '',
                station?.load?.trim(),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <button
            type="button"
            disabled={safe >= stations.length - 1}
            onClick={() =>
              setStationIndex((i) => Math.min(stations.length - 1, i + 1))
            }
            className="rounded-full border border-white/10 p-2 text-zinc-300 disabled:opacity-30"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        {!done ? (
          <button
            type="button"
            onClick={() => {
              onSetCompleted?.(station?.restSec);
              if (safe < stations.length - 1) {
                setStationIndex(safe + 1);
              } else {
                onChangeSheet(markSectionDone(sheet, sectionId));
                onAdvance?.();
              }
            }}
            className="w-full rounded-2xl bg-forma-500 py-2.5 text-sm font-semibold text-ink"
          >
            {safe < stations.length - 1 ? 'Следующая станция' : 'Дальше'}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md text-center text-sm text-zinc-500">
      Блок «{WORKOUT_SECTION_LABELS[sectionId]}»
    </div>
  );
}

export function hasLiveSessionBlocks(sheet: WorkoutSheet): boolean {
  return getSessionSectionIds(sheet).length > 0;
}

export function hasAnyLiveContent(sheet: WorkoutSheet): boolean {
  return hasLiveSessionBlocks(sheet) || hasLiveStrengthExercises(sheet);
}
