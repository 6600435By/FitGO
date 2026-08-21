'use client';

import type { PrepActivityRow, PrepFieldId, PrepSectionId, WorkoutSheet } from '@fitgo/shared-types';
import {
  PREP_FIELD_LABELS,
  PREP_FIELD_PLACEHOLDERS,
  WARMUP_ACTIVITY_TYPES,
  COOLDOWN_ACTIVITY_TYPES,
  WORKOUT_SECTION_LABELS,
  applyPrepBlockSessionToSheet,
  formatBlockSessionClock,
  markWorkoutSessionStarted,
  prepActivityLabel,
  saveBlockSummary,
  completeWorkoutSection,
  updateSectionSummaryNote,
} from '@fitgo/shared-types';
import { ChevronDown, ChevronUp, Pause, Play, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PrepBlockCompletion } from './prep-block-completion';
import { usePrepBlockSession } from './use-prep-block-session';

interface PrepBlockSessionProps {
  variant: PrepSectionId;
  activities: PrepActivityRow[];
  activeFields: PrepFieldId[];
  sheet: WorkoutSheet;
  onClose: () => void;
  onChange: (sheet: WorkoutSheet) => void;
}

export function PrepBlockSession({
  variant,
  activities,
  activeFields,
  sheet,
  onClose,
  onChange,
}: PrepBlockSessionProps) {
  const [localActivities, setLocalActivities] = useState(activities);
  const [summaryNote, setSummaryNote] = useState(
    () => sheet.blockProgress?.[variant]?.summaryNote ?? '',
  );
  const [editOpen, setEditOpen] = useState(false);
  const autoStarted = useRef(false);

  const session = usePrepBlockSession({
    activities: localActivities,
    onActivitiesChange: setLocalActivities,
  });

  useEffect(() => {
    setLocalActivities(activities);
    setSummaryNote(sheet.blockProgress?.[variant]?.summaryNote ?? '');
  }, [activities, sheet.blockProgress, variant]);

  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    onChange(markWorkoutSessionStarted(sheet));
    session.startSession();
    // Запуск один раз при открытии панели
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = WORKOUT_SECTION_LABELS[variant];
  const activityTypes =
    variant === 'warmup' ? WARMUP_ACTIVITY_TYPES : COOLDOWN_ACTIVITY_TYPES;

  const phaseLabel =
    session.phase === 'work'
      ? session.planReached
        ? 'Работа · факт'
        : 'Работа'
      : session.phase === 'rest'
        ? 'Отдых'
        : session.phase === 'block_rest'
          ? 'Отдых до след. блока'
          : '';

  const handleSave = () => {
    let next = applyPrepBlockSessionToSheet(
      sheet,
      variant,
      localActivities,
      session.timings,
      session.blockRestElapsed,
    );
    next = completeWorkoutSection(next, variant);
    next = updateSectionSummaryNote(next, variant, summaryNote);
    next = saveBlockSummary(next, variant);
    onChange(next);
    onClose();
  };

  const showPlanExtend =
    session.phase === 'work' && session.effectivePlanSec != null;

  return (
    <div className="mb-4 rounded-xl border border-fitgo-500/40 bg-slate-900/70 p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-fitgo-400">
            Таймер · {title}
          </p>
          {session.phase !== 'summary' && (
            <p className="truncate text-sm text-slate-400">
              Этап {session.stepIndex + 1}/{session.stepCount}
              {session.current &&
                ` · ${prepActivityLabel(session.current, session.stepIndex)}`}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
          aria-label="Закрыть таймер"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {session.phase === 'summary' ? (
        <PrepBlockCompletion
          variant={variant}
          activities={localActivities}
          timings={session.timings}
          blockRestSec={session.blockRestElapsed}
          summaryNote={summaryNote}
          onTimingsChange={session.setSummaryTimings}
          onBlockRestChange={session.setBlockRestElapsed}
          onSummaryNoteChange={setSummaryNote}
          onBack={() => session.setPhase('block_rest')}
          onSave={handleSave}
        />
      ) : (
        <div className="space-y-4">
          <div className="text-center">
            <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">
              {phaseLabel}
            </p>
            <p className="font-mono text-4xl font-bold tabular-nums text-white">
              {formatBlockSessionClock(session.displaySec)}
            </p>
            {session.phase === 'work' && session.plannedWorkSec != null && (
              <p className="mt-1 text-xs text-slate-500">
                План: {formatBlockSessionClock(session.plannedWorkSec)}
                {session.planReached && (
                  <span className="ml-2 text-amber-400/90">
                    · факт {formatBlockSessionClock(session.workElapsed)}
                  </span>
                )}
              </p>
            )}
          </div>

          {showPlanExtend && (
            <div className="flex justify-center gap-2">
              <button
                type="button"
                onClick={() => session.extendPlan(15)}
                className="btn-secondary px-3 text-sm"
              >
                +15с к плану
              </button>
              <button
                type="button"
                onClick={() => session.extendPlan(30)}
                className="btn-secondary px-3 text-sm"
              >
                +30с к плану
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {session.phase === 'work' && (
              <>
                <button
                  type="button"
                  onClick={session.togglePause}
                  className="btn-secondary flex flex-1 items-center justify-center gap-2 text-sm"
                >
                  {session.running ? (
                    <>
                      <Pause className="h-4 w-4" />
                      Пауза
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      Продолжить
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={session.completeStep}
                  className="btn-primary flex-1 text-sm"
                >
                  Этап готов
                </button>
              </>
            )}
            {session.phase === 'rest' && (
              <button
                type="button"
                onClick={session.completeStep}
                className="btn-primary w-full text-sm"
              >
                {session.isLastStep ? 'Завершить этапы' : 'Следующий этап'}
              </button>
            )}
            {session.phase === 'block_rest' && (
              <button
                type="button"
                onClick={session.openSummary}
                className="btn-primary w-full text-sm"
              >
                Завершить блок
              </button>
            )}
          </div>

          {session.phase !== 'block_rest' && (
            <button
              type="button"
              onClick={session.openSummary}
              className="btn-secondary w-full text-sm"
            >
              Завершить блок
            </button>
          )}

          <button
            type="button"
            onClick={() => setEditOpen((v) => !v)}
            className="flex w-full items-center justify-center gap-1 text-xs text-slate-500"
          >
            {editOpen ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" /> Скрыть этап
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" /> Редактировать этап
              </>
            )}
          </button>

          {editOpen && session.current && (
            <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-800/40 p-3">
              {activeFields.includes('type') && (
                <div className="flex flex-wrap gap-1">
                  {activityTypes.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() =>
                        session.updateStep(session.stepIndex, { type: t.label })
                      }
                      className={`rounded-md px-2 py-1 text-[11px] ${
                        session.current?.type === t.label
                          ? 'bg-fitgo-500/30 text-fitgo-300'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
              {activeFields.map((field) => (
                <div key={field}>
                  <label className="text-[10px] uppercase text-slate-600">
                    {PREP_FIELD_LABELS[field]}
                  </label>
                  <input
                    className="input mt-0.5 w-full text-sm"
                    placeholder={PREP_FIELD_PLACEHOLDERS[field]}
                    value={session.current?.[field] ?? ''}
                    onChange={(e) =>
                      session.updateStep(session.stepIndex, {
                        [field]: e.target.value,
                      })
                    }
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={session.addStep}
                className="flex w-full items-center justify-center gap-1 text-sm text-fitgo-400"
              >
                <Plus className="h-4 w-4" />
                Добавить этап
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
