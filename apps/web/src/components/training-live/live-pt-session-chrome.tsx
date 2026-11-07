'use client';

import type { WorkoutSheet } from '@fitgo/shared-types';
import {
  completeWorkoutSession,
  createEmptyWorkoutSheet,
  normalizeWorkoutSheet,
} from '@fitgo/shared-types';
import { NotebookPen, Flag } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { SessionFinishSummary } from '@/components/personal-training/session-finish-summary';
import { SessionNotesSheet } from '@/components/personal-training/session-notes-sheet';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export function LivePtSessionChrome({
  bookingId,
  clientId,
  elapsedMs,
  onFinished,
}: {
  bookingId: string;
  clientId?: string;
  elapsedMs: number;
  onFinished?: () => void;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [sheet, setSheet] = useState<WorkoutSheet>(createEmptyWorkoutSheet());
  const [homeworkDraft, setHomeworkDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [goals, setGoals] = useState<Array<{ title: string }>>([]);

  const reload = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    const detail = await api.personalSessionDetail(token, bookingId);
    setSheet(normalizeWorkoutSheet(detail.workoutSheet));
    setGoals(detail.goals.map((g) => ({ title: g.title })));
  }, [bookingId]);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  const saveNotes = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      await api.personalSessionUpdatePlan(token, bookingId, {
        goals: goals.filter((g) => g.title.trim()),
        workoutSheet: sheet,
      });
      if (homeworkDraft.trim() && clientId) {
        await api.trainerCreateHomework(token, {
          clientId,
          bookingId,
          summary: homeworkDraft.trim(),
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
      const hasHw = Boolean(homeworkDraft.trim());
      if (hasHw && clientId) {
        await api.trainerCreateHomework(token, {
          clientId,
          bookingId,
          summary: homeworkDraft.trim(),
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
        onChangeClient={(notes) => setSheet((s) => ({ ...s, notes }))}
        onChangePrivate={(trainerPrivateNotes) =>
          setSheet((s) => ({ ...s, trainerPrivateNotes }))
        }
        onChangeHomework={setHomeworkDraft}
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
