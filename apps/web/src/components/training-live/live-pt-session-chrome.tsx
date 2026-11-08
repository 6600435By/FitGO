'use client';

import type { WorkoutSheet } from '@fitgo/shared-types';
import {
  completeWorkoutSession,
  createEmptyWorkoutSheet,
  normalizeWorkoutSheet,
} from '@fitgo/shared-types';
import { NotebookPen, Flag } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { SessionFinishSummary } from '@/components/personal-training/session-finish-summary';
import { SessionNotesSheet } from '@/components/personal-training/session-notes-sheet';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export function LivePtSessionChrome({
  bookingId,
  clientId,
  elapsedMs,
  sheet,
  setSheet,
  onFinished,
  hideActionButtons = false,
  notesOpen: notesOpenProp,
  onNotesOpenChange,
  finishOpen: finishOpenProp,
  onFinishOpenChange,
}: {
  bookingId: string;
  clientId?: string;
  elapsedMs: number;
  sheet: WorkoutSheet;
  setSheet: Dispatch<SetStateAction<WorkoutSheet>>;
  onFinished?: () => void;
  /** When parent renders its own footer buttons. */
  hideActionButtons?: boolean;
  notesOpen?: boolean;
  onNotesOpenChange?: (open: boolean) => void;
  finishOpen?: boolean;
  onFinishOpenChange?: (open: boolean) => void;
}) {
  const [notesOpenLocal, setNotesOpenLocal] = useState(false);
  const [finishOpenLocal, setFinishOpenLocal] = useState(false);
  const notesOpen = notesOpenProp ?? notesOpenLocal;
  const setNotesOpen = onNotesOpenChange ?? setNotesOpenLocal;
  const finishOpen = finishOpenProp ?? finishOpenLocal;
  const setFinishOpen = onFinishOpenChange ?? setFinishOpenLocal;

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

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    api
      .personalSessionDetail(token, bookingId)
      .then((detail) => {
        if (cancelled) return;
        setGoals(detail.goals.map((g) => ({ title: g.title })));
      })
      .catch(() => undefined);
    if (clientId) {
      api
        .trainerClientHomework(token, clientId)
        .then((list) => {
          if (cancelled) return;
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
        })
        .catch(() => {
          if (!cancelled) setActiveHomeworkProgress(null);
        });
    }
    return () => {
      cancelled = true;
    };
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
      {!hideActionButtons ? (
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
      ) : null}

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
        onChangeMaxHr={(maxHr) => setSheet((s) => ({ ...s, maxHr }))}
        onSend={sendAndComplete}
        busy={busy}
      />
    </>
  );
}

/** Load + debounce-save helper used by LiveTimerScreen for PT sheet. */
export function useLivePtSheet(bookingId: string | undefined) {
  const [sheet, setSheet] = useState<WorkoutSheet>(createEmptyWorkoutSheet());
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef<number | null>(null);
  const goalsRef = useRef<Array<{ title: string }>>([]);

  useEffect(() => {
    if (!bookingId) return;
    let cancelled = false;
    const token = getToken();
    if (!token) return;
    api
      .personalSessionDetail(token, bookingId)
      .then((detail) => {
        if (cancelled) return;
        setSheet(normalizeWorkoutSheet(detail.workoutSheet));
        goalsRef.current = detail.goals.map((g) => ({ title: g.title }));
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  const persistSoon = useCallback(
    (next: WorkoutSheet) => {
      if (!bookingId) return;
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        const token = getToken();
        if (!token) return;
        api
          .personalSessionUpdatePlan(token, bookingId, {
            goals: goalsRef.current.filter((g) => g.title.trim()),
            workoutSheet: next,
          })
          .catch(() => undefined);
      }, 400);
    },
    [bookingId],
  );

  const updateSheet = useCallback(
    (next: SetStateAction<WorkoutSheet>) => {
      setSheet((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        persistSoon(resolved);
        return resolved;
      });
    },
    [persistSoon],
  );

  return { sheet, setSheet: updateSheet, loaded, goalsRef };
}
