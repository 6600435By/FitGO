'use client';

import type { WorkoutSheet } from '@fitgo/shared-types';
import {
  completeWorkoutSession,
  createEmptyWorkoutSheet,
  normalizeWorkoutSheet,
} from '@fitgo/shared-types';
import { NotebookPen, Flag } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { SessionFinishSummary } from '@/components/personal-training/session-finish-summary';
import { SessionNotesSheet } from '@/components/personal-training/session-notes-sheet';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import {
  buildCircuitTimer,
  CIRCUIT_SHEET_PRESET_ID,
  type BuiltPreset,
  type CircuitPhaseBinding,
  type TimerEvent,
  type TimerPersistedState,
} from '@/lib/training-timer';
import { applyCircuitTimerEvents } from './apply-circuit-timer-fact';

export type LiveTimerFactHandler = (
  events: TimerEvent[],
  state: TimerPersistedState,
) => void;

export function LivePtSessionChrome({
  bookingId,
  clientId,
  elapsedMs,
  applyPreset,
  factHandlerRef,
  onFinished,
}: {
  bookingId: string;
  clientId?: string;
  elapsedMs: number;
  /** Seed / switch live timer from the sheet circuit. */
  applyPreset?: (preset: BuiltPreset) => void;
  /** Parent timer commits phase_end here so we write fact into the sheet. */
  factHandlerRef?: MutableRefObject<LiveTimerFactHandler | null>;
  onFinished?: () => void;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [sheet, setSheet] = useState<WorkoutSheet>(createEmptyWorkoutSheet());
  const [homeworkDraft, setHomeworkDraft] = useState('');
  const [homeworkItems, setHomeworkItems] = useState<
    Array<{
      kind?: string;
      title: string;
      target?: string;
      timesRequired?: number;
    }>
  >([]);
  const [activeHomeworkProgress, setActiveHomeworkProgress] = useState<{
    done: number;
    total: number;
    summary?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [goals, setGoals] = useState<Array<{ title: string }>>([]);
  const bindingsRef = useRef<CircuitPhaseBinding[]>([]);
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const seededCircuitRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);

  const reload = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    const detail = await api.personalSessionDetail(token, bookingId);
    setSheet(normalizeWorkoutSheet(detail.workoutSheet));
    setGoals(detail.goals.map((g) => ({ title: g.title })));
    if (clientId) {
      try {
        const list = await api.trainerClientHomework(token, clientId);
        const active = list.find((h) => h.status === 'ACTIVE');
        setActiveHomeworkProgress(
          active
            ? {
                done: active.progress.done,
                total: active.progress.total,
                summary: active.summary,
              }
            : null,
        );
      } catch {
        setActiveHomeworkProgress(null);
      }
    }
  }, [bookingId, clientId]);

  const homeworkPayload = () => {
    const summary = homeworkDraft.trim();
    if (!summary && homeworkItems.length === 0) return null;
    return {
      summary: summary || undefined,
      items:
        homeworkItems.length > 0
          ? homeworkItems.map((i) => ({
              kind: i.kind,
              title: i.title,
              target: i.target,
              timesRequired: i.timesRequired,
            }))
          : undefined,
    };
  };

  const repeatPreviousHomework = async () => {
    const token = getToken();
    if (!token || !clientId) return;
    const prev = await api.trainerPreviousHomework(token, clientId);
    if (!prev) {
      window.alert('Прошлого задания пока нет');
      return;
    }
    setHomeworkDraft(prev.summary?.trim() || 'Прошлое задание');
    setHomeworkItems(
      prev.items.map((i) => ({
        kind: i.kind,
        title: i.title,
        target: i.target ?? undefined,
        timesRequired: i.timesRequired,
      })),
    );
  };

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  useEffect(() => {
    const circuit = sheet.circuit;
    if (!circuit?.stations?.length) return;
    const built = buildCircuitTimer(circuit);
    if (built.phases.length === 0) return;
    bindingsRef.current = built.bindings;
    if (!applyPreset || seededCircuitRef.current) return;
    seededCircuitRef.current = true;
    applyPreset(built.preset);
  }, [sheet.circuit, applyPreset]);

  const persistSheet = useCallback(
    async (next: WorkoutSheet) => {
      const token = getToken();
      if (!token) return;
      await api.personalSessionUpdatePlan(token, bookingId, {
        goals: goals.filter((g) => g.title.trim()),
        workoutSheet: next,
      });
    },
    [bookingId, goals],
  );

  const handleTimerEvents = useCallback(
    (events: TimerEvent[], state: TimerPersistedState) => {
      if (state.presetId !== CIRCUIT_SHEET_PRESET_ID) return;
      if (!events.some((e) => e.kind === 'phase_end' || e.kind === 'complete')) {
        return;
      }
      const next = applyCircuitTimerEvents(
        sheetRef.current,
        events,
        state,
        bindingsRef.current,
      );
      if (next === sheetRef.current) return;
      setSheet(next);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        persistSheet(next).catch(() => undefined);
      }, 400);
    },
    [persistSheet],
  );

  useEffect(() => {
    if (!factHandlerRef) return;
    factHandlerRef.current = handleTimerEvents;
    return () => {
      factHandlerRef.current = null;
    };
  }, [factHandlerRef, handleTimerEvents]);

  const saveNotes = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      await api.personalSessionUpdatePlan(token, bookingId, {
        goals: goals.filter((g) => g.title.trim()),
        workoutSheet: sheet,
      });
      const hw = homeworkPayload();
      if (hw && clientId) {
        await api.trainerCreateHomework(token, {
          clientId,
          bookingId,
          ...hw,
        });
      }
      setNotesOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const sendAndComplete = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      const nextSheet = completeWorkoutSession(sheet);
      await api.personalSessionUpdatePlan(token, bookingId, {
        goals: goals.filter((g) => g.title.trim()),
        workoutSheet: nextSheet,
      });
      setSheet(nextSheet);
      const hw = homeworkPayload();
      if (hw && clientId) {
        await api.trainerCreateHomework(token, {
          clientId,
          bookingId,
          ...hw,
        });
      } else {
        await api.trainerNotifySessionNotes(token, bookingId, false);
      }
      await api.personalSessionComplete(token, bookingId);
      setFinishOpen(false);
      onFinished?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-center gap-2 px-4 pb-2">
        <button
          type="button"
          onClick={() => setNotesOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-200"
        >
          <NotebookPen className="h-4 w-4 text-forma-400" />
          Заметка
        </button>
        <button
          type="button"
          onClick={() => setFinishOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-2xl bg-forma-500 px-3 py-2 text-sm font-semibold text-ink"
        >
          <Flag className="h-4 w-4" />
          Завершить
        </button>
      </div>

      <SessionNotesSheet
        open={notesOpen}
        onOpenChange={setNotesOpen}
        clientNotes={sheet.notes ?? ''}
        privateNotes={sheet.trainerPrivateNotes ?? ''}
        homeworkDraft={homeworkDraft}
        homeworkItems={homeworkItems}
        onChangeClient={(notes) => setSheet((s) => ({ ...s, notes }))}
        onChangePrivate={(trainerPrivateNotes) =>
          setSheet((s) => ({ ...s, trainerPrivateNotes }))
        }
        onChangeHomework={setHomeworkDraft}
        onChangeHomeworkItems={setHomeworkItems}
        onRepeatPrevious={clientId ? repeatPreviousHomework : undefined}
        activeHomeworkProgress={activeHomeworkProgress}
        busy={busy}
        onSave={saveNotes}
      />

      <SessionFinishSummary
        open={finishOpen}
        onOpenChange={setFinishOpen}
        sheet={sheet}
        elapsedMs={elapsedMs}
        clientNotes={sheet.notes ?? ''}
        privateNotes={sheet.trainerPrivateNotes ?? ''}
        homeworkDraft={homeworkDraft}
        onChangeRpe={(sessionRpe) => setSheet((s) => ({ ...s, sessionRpe }))}
        onSend={sendAndComplete}
        busy={busy}
      />
    </>
  );
}
