'use client';

import type { WorkoutSectionId, WorkoutSheet } from '@fitgo/shared-types';
import {
  WORKOUT_SECTION_LABELS,
  applyWorkoutSessionToSheet,
  completeWorkoutSection,
  completeWorkoutSession,
  formatBlockSessionClock,
  getUniqueSessionBlocks,
  saveBlockSummary,
  updateSectionSummaryNote,
  type WorkoutSessionStep,
} from '@fitgo/shared-types';
import { Pause, Play, Timer, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { emitWorkoutTimerDockChrome } from './workout-timer-chrome';
import type { useWorkoutSession } from './use-workout-session';
import { WorkoutSessionCapture } from './workout-session-capture';
import { WorkoutSessionCompletion } from './workout-session-completion';
import { WorkoutSessionFieldPicker } from './workout-session-field-picker';
import { WorkoutSessionPlanPreview } from './workout-session-plan-preview';
import { getSessionStepContext } from './workout-session-step-context';

interface WorkoutSessionOverlayProps {
  open: boolean;
  sheet: WorkoutSheet;
  steps: WorkoutSessionStep[];
  session: ReturnType<typeof useWorkoutSession>;
  onMinimize: () => void;
  onChange: (sheet: WorkoutSheet) => void;
  onSessionEnd: () => void;
}

export function WorkoutSessionOverlay({
  open,
  sheet,
  steps,
  session,
  onMinimize,
  onChange,
  onSessionEnd,
}: WorkoutSessionOverlayProps) {
  const [mounted, setMounted] = useState(false);

  const [blockNotes, setBlockNotes] = useState<
    Partial<Record<WorkoutSectionId, string>>
  >(() => {
    const notes: Partial<Record<WorkoutSectionId, string>> = {};
    for (const blockId of getUniqueSessionBlocks(steps)) {
      notes[blockId] = sheet.blockProgress?.[blockId]?.summaryNote ?? '';
    }
    return notes;
  });

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) {
      emitWorkoutTimerDockChrome({
        active: true,
        atTop: true,
        overlayOpen: true,
      });
      return () => {
        emitWorkoutTimerDockChrome({
          active: false,
          atTop: false,
          overlayOpen: false,
        });
      };
    }
  }, [open]);

  const stepContext = useMemo(
    () => getSessionStepContext(sheet, session.current),
    [sheet, session.current],
  );

  const phaseLabel =
    session.phase === 'work'
      ? session.planReached
        ? 'Работа · факт'
        : 'Работа'
      : session.phase === 'rest'
        ? session.restCountdown
          ? 'Отдых'
          : 'Отдых · свободный'
        : session.phase === 'block_rest'
          ? 'Отдых до след. блока'
          : session.phase === 'block_summary'
            ? 'Итог блока'
            : '';

  const handleSave = () => {
    let next = applyWorkoutSessionToSheet(
      sheet,
      steps,
      session.timings,
      session.blockRests,
    );
    for (const blockId of getUniqueSessionBlocks(steps)) {
      next = updateSectionSummaryNote(
        next,
        blockId,
        blockNotes[blockId]?.trim() ?? '',
      );
      next = completeWorkoutSection(next, blockId);
      next = saveBlockSummary(next, blockId);
    }
    next = completeWorkoutSession(next);
    onChange(next);
    onSessionEnd();
  };

  const patchSheet = (next: WorkoutSheet) => {
    onChange(next);
  };

  const completedBlockId = session.current?.blockId;
  const currentBlockId = session.current?.blockId;

  if (!mounted || !open) return null;

  const content = (
    <div className="fixed inset-0 z-[70] flex justify-center bg-black/60">
      <div className="flex h-full w-full max-w-lg flex-col bg-slate-950">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex min-w-0 items-center gap-2">
            <Timer className="h-5 w-5 shrink-0 text-fitgo-400" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Таймер тренировки</p>
              {session.phase !== 'summary' && session.current && (
                <p className="truncate text-xs text-slate-500">
                  {WORKOUT_SECTION_LABELS[session.current.blockId]} ·{' '}
                  {session.stepIndex + 1}/{session.stepCount}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onMinimize}
            className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-800"
            aria-label="Свернуть таймер"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
          {steps.length === 0 ? (
            <div className="flex flex-1 flex-col justify-center text-center text-sm text-amber-200">
              Нет этапов для таймера.
            </div>
          ) : session.phase === 'summary' ? (
            <WorkoutSessionCompletion
              sheet={sheet}
              steps={steps}
              timings={session.timings}
              blockRests={session.blockRests}
              blockNotes={blockNotes}
              onTimingsChange={session.setSummaryTimings}
              onBlockRestChange={(blockId, sec) =>
                session.setBlockRests((prev) => ({ ...prev, [blockId]: sec }))
              }
              onBlockNoteChange={(blockId, note) =>
                setBlockNotes((prev) => ({ ...prev, [blockId]: note }))
              }
              onSave={handleSave}
            />
          ) : session.phase === 'block_summary' && completedBlockId ? (
            <div className="flex flex-1 flex-col gap-4">
              <div className="text-center">
                <p className="text-xs uppercase tracking-wide text-fitgo-400">
                  {phaseLabel}
                </p>
                <h2 className="mt-1 text-xl font-semibold">
                  {WORKOUT_SECTION_LABELS[completedBlockId]}
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Запишите наблюдения по блоку
                </p>
              </div>
              <textarea
                className="input min-h-[120px] w-full flex-1 text-sm"
                placeholder="Итог по блоку…"
                value={blockNotes[completedBlockId] ?? ''}
                onChange={(e) =>
                  setBlockNotes((prev) => ({
                    ...prev,
                    [completedBlockId]: e.target.value,
                  }))
                }
                autoFocus
              />
              <button
                type="button"
                onClick={session.primaryAction}
                className="btn-primary w-full py-3 text-sm"
              >
                {session.primaryLabel}
              </button>
            </div>
          ) : (
            <div className="flex flex-1 flex-col gap-4">
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                {session.current && (
                  <p className="mb-2 max-w-full truncate text-sm text-slate-300">
                    {session.current.label}
                    {session.current.subtitle ? (
                      <span className="block text-xs text-slate-500">
                        {session.current.subtitle}
                      </span>
                    ) : null}
                  </p>
                )}
                <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">
                  {phaseLabel}
                </p>
                <p className="font-mono text-6xl font-bold tabular-nums text-white">
                  {formatBlockSessionClock(session.displaySec)}
                </p>
                {session.phase === 'work' && session.effectivePlanSec != null && (
                  <p className="mt-2 text-xs text-slate-500">
                    План: {formatBlockSessionClock(session.effectivePlanSec)}
                    {session.planReached && (
                      <span className="ml-2 text-amber-400/90">
                        · факт {formatBlockSessionClock(session.workElapsed)}
                      </span>
                    )}
                  </p>
                )}
                {stepContext.targetHr != null && session.phase === 'work' && (
                  <p className="mt-1 text-xs text-sky-400/90">
                    Цель ЧСС: {stepContext.targetHr}
                  </p>
                )}
                {stepContext.targetZone && session.phase === 'work' && (
                  <p className="mt-1 text-xs text-sky-400/90">
                    Зона: {stepContext.targetZone}
                  </p>
                )}
              </div>

              {currentBlockId && (
                <WorkoutSessionFieldPicker
                  sheet={sheet}
                  blockId={currentBlockId}
                  onSheetChange={patchSheet}
                />
              )}

              {session.phase === 'work' &&
                session.current &&
                stepContext.captureFields.length > 0 && (
                  <WorkoutSessionCapture
                    sheet={sheet}
                    step={session.current}
                    fields={stepContext.captureFields}
                    onSheetChange={patchSheet}
                  />
                )}

              {session.phase === 'work' &&
                session.effectivePlanSec != null && (
                  <div className="flex justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => session.extendPlan(15)}
                      className="btn-secondary px-3 text-sm"
                    >
                      +15с
                    </button>
                    <button
                      type="button"
                      onClick={() => session.extendPlan(30)}
                      className="btn-secondary px-3 text-sm"
                    >
                      +30с
                    </button>
                  </div>
                )}

              <div className="flex gap-2">
                {session.phase === 'work' && (
                  <button
                    type="button"
                    onClick={session.togglePause}
                    className="btn-secondary flex flex-1 items-center justify-center gap-2 py-3 text-sm"
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
                )}
                <button
                  type="button"
                  onClick={session.primaryAction}
                  className="btn-primary flex-1 py-3 text-sm"
                >
                  {session.primaryLabel}
                </button>
              </div>

              {session.phase === 'work' && session.current && (
                <WorkoutSessionPlanPreview
                  sheet={sheet}
                  step={session.current}
                  context={stepContext}
                />
              )}

              <button
                type="button"
                onClick={session.openSummary}
                className="btn-secondary w-full text-sm"
              >
                Завершить тренировку
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
