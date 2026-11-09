'use client';

import type {
  PersonalTrainingGoalTemplate,
  PersonalTrainingSessionDetail,
  PersonalTrainingSessionGoal,
  WorkoutSheet,
} from '@fitgo/shared-types';
import {
  ageFromDateOfBirth,
  createEmptyWorkoutSheet,
  createDefaultCircuit,
  ensureCircuitRoundLogs,
  getWorkoutBlocks,
  normalizeWorkoutSheet,
  workoutSheetHasData,
} from '@fitgo/shared-types';
import { SegmentedControl } from '@fitgo/forma-ui';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useFeatures } from '@/components/features-provider';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import {
  formatDateTime,
  sessionStatusColor,
  sessionStatusLabel,
} from '@/lib/utils';
import {
  SessionContextStrip,
  type PreviousSessionMeta,
} from './session-context-strip';
import {
  SessionControlFollowUp,
  SessionLifecycleStrip,
} from './session-lifecycle-panel';
import { SessionNotesSheet } from './session-notes-sheet';
import { WorkoutSheetEditor } from './workout-sheet-editor';

type DraftGoal = {
  id?: string;
  title: string;
  notes?: string;
  tasks: Array<{ id?: string; title: string }>;
};

function planFingerprint(
  goals: DraftGoal[],
  sheet: WorkoutSheet,
): string {
  return JSON.stringify({
    goals: goals.map((g) => ({
      id: g.id,
      title: g.title.trim(),
      notes: (g.notes ?? '').trim(),
      tasks: g.tasks
        .map((t) => ({ id: t.id, title: t.title.trim() }))
        .filter((t) => t.title),
    })),
    sheet: ensureCircuitRoundLogs(normalizeWorkoutSheet(sheet)),
  });
}

interface SessionPlanEditorProps {
  bookingId: string;
  backHref: string;
  backLabel: string;
  viewerRole: 'client' | 'trainer';
}

export function SessionPlanEditor({
  bookingId,
  backHref,
  backLabel,
  viewerRole,
}: SessionPlanEditorProps) {
  const { isEnabled } = useFeatures();
  const formaLive = isEnabled('trainer_ui_v2');
  const [session, setSession] = useState<PersonalTrainingSessionDetail | null>(
    null,
  );
  const [templates, setTemplates] = useState<PersonalTrainingGoalTemplate[]>(
    [],
  );
  const [draftGoals, setDraftGoals] = useState<DraftGoal[]>([]);
  const [draftWorkoutSheet, setDraftWorkoutSheet] = useState<WorkoutSheet>(
    createEmptyWorkoutSheet(),
  );
  const [activeTab, setActiveTab] = useState<'sheet' | 'goals'>('sheet');
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
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
  const [savedFingerprint, setSavedFingerprint] = useState('');
  const [previousMeta, setPreviousMeta] = useState<PreviousSessionMeta>({
    loaded: false,
  });

  const applySession = (data: PersonalTrainingSessionDetail) => {
    const goals = data.goals.map((g) => ({
      id: g.id,
      title: g.title,
      notes: g.notes,
      tasks: g.tasks.map((t) => ({ id: t.id, title: t.title })),
    }));
    const sheet = normalizeWorkoutSheet(data.workoutSheet);
    setSession(data);
    setDraftGoals(goals);
    setDraftWorkoutSheet(sheet);
    setSavedFingerprint(planFingerprint(goals, sheet));
    setEditing(false);
  };

  const loadActiveHomework = async (clientId: string) => {
    const token = getToken();
    if (!token) return;
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
  };

  const loadPreviousMeta = async () => {
    const token = getToken();
    if (!token) {
      setPreviousMeta({ loaded: true });
      return;
    }
    try {
      const prev = await api.personalSessionPreviousSheet(token, bookingId);
      setPreviousMeta({
        loaded: true,
        bookingId: prev.bookingId,
        date: prev.date,
        summary: prev.summary,
      });
    } catch {
      setPreviousMeta({ loaded: true });
    }
  };

  const load = async () => {
    const token = getToken();
    if (!token) return;
    const data = await api.personalSessionDetail(token, bookingId);
    applySession(data);
    if (viewerRole === 'trainer') {
      await Promise.all([
        loadActiveHomework(data.clientId),
        loadPreviousMeta(),
      ]);
    }
  };

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    setPreviousMeta({ loaded: false });
    Promise.all([
      api.personalSessionDetail(token, bookingId),
      api.personalGoalTemplates(token),
    ])
      .then(async ([data, tpls]) => {
        applySession(data);
        setTemplates(tpls);
        if (viewerRole === 'trainer') {
          await Promise.all([
            loadActiveHomework(data.clientId),
            loadPreviousMeta(),
          ]);
        }
      })
      .catch((err) => setError(err.message));
  }, [bookingId]);

  const savePlan = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const data = await api.personalSessionUpdatePlan(token, bookingId, {
        goals: draftGoals.filter((g) => g.title.trim()),
        workoutSheet: ensureCircuitRoundLogs(draftWorkoutSheet),
      });
      applySession(data);
      setMessage(
        'Лист сохранён на сервере. Посещение и оплату это не отмечает.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  };

  const applyTemplate = (template: PersonalTrainingGoalTemplate) => {
    setDraftGoals((prev) => [
      ...prev,
      {
        title: template.title,
        notes: template.description,
        tasks: template.suggestedTasks.map((title) => ({ title })),
      },
    ]);
    setEditing(true);
  };

  const confirmGoal = async (goalId: string) => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      const data = await api.personalSessionConfirmGoal(
        token,
        bookingId,
        goalId,
      );
      setSession(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const confirmTask = async (taskId: string) => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      const data = await api.personalSessionConfirmTask(
        token,
        bookingId,
        taskId,
      );
      setSession(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const dirty = useMemo(() => {
    if (!savedFingerprint) return false;
    return (
      planFingerprint(draftGoals, draftWorkoutSheet) !== savedFingerprint
    );
  }, [draftGoals, draftWorkoutSheet, savedFingerprint]);

  const completeSession = async (opts?: { retry?: boolean }) => {
    const token = getToken();
    if (!token) return;
    if (!opts?.retry && dirty) {
      setError(
        'Сначала сохраните лист — подтверждение не записывает черновик',
      );
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const data = await api.personalSessionComplete(token, bookingId);
      applySession(data);
      setMessage(
        opts?.retry
          ? 'Повтор выполнен: второе списание не создаётся'
          : 'Проведение подтверждено',
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message}. Результат листа сохранён — можно повторить подтверждение.`
          : 'Ошибка подтверждения. Можно повторить без потери листа.',
      );
    } finally {
      setBusy(false);
    }
  };

  const isClient = viewerRole === 'client';
  const isTrainer = !isClient;
  const counterpartName = isClient
    ? session?.trainerName
    : session?.clientName;

  const showRetryComplete =
    isTrainer &&
    Boolean(session?.trainerCompletedAt) &&
    session?.status === 'COMPLETED' &&
    ((session.ptFlow === 'PERSONAL' && !session.ledgerSettledAt) ||
      (Boolean(session?.ptControlApplies) && !session.linkedDocExternalId));

  if (error && !session) {
    return <p className="text-red-400">{error}</p>;
  }

  if (!session) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  const showConfirmations =
    session.status !== 'CANCELLED' &&
    new Date(session.startAt) <= new Date();

  const myGoalConfirmed = (goal: PersonalTrainingSessionGoal) =>
    isClient ? goal.clientConfirmed : goal.trainerConfirmed;

  const primaryGoal =
    draftGoals.find((g) => g.title.trim())?.title ||
    session.goals.find((g) => g.title.trim())?.title;

  const profileAge = session.clientDateOfBirth
    ? ageFromDateOfBirth(
        session.clientDateOfBirth,
        new Date(session.startAt),
      )
    : undefined;

  const liveHref =
    isTrainer && session.clientId
      ? `/trainer/live/pt/${encodeURIComponent(bookingId)}?title=${encodeURIComponent(session.clientName || 'ПТ')}&clientId=${encodeURIComponent(session.clientId)}`
      : isTrainer
        ? `/trainer/live/pt/${encodeURIComponent(bookingId)}?title=${encodeURIComponent(session.clientName || 'ПТ')}`
        : null;

  return (
    <div className="space-y-4">
      <Link href={backHref} className="text-sm text-forma-400 text-fitgo-400">
        ← {backLabel}
      </Link>

      <div className="card">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-zinc-500 text-slate-500">
              Персональная тренировка
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold text-white sm:text-2xl">
              {counterpartName || 'Клиент'}
            </h2>
            <p className="mt-1 text-sm text-zinc-400 text-slate-400">
              {formatDateTime(session.startAt)}
              {primaryGoal ? ` · ${primaryGoal}` : ''}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-1 text-xs ${sessionStatusColor(session.status)}`}
          >
            {sessionStatusLabel(session.status)}
          </span>
        </div>

        {isTrainer ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {liveHref ? (
              <Link href={liveHref} className="btn-primary">
                Режим тренировки
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => setNotesOpen(true)}
              className="btn-secondary"
            >
              Заметки
            </button>
          </div>
        ) : null}

        {session.status === 'AWAITING_CONFIRMATION' && !session.trainerCompletedAt && (
          <p className="mt-3 text-sm text-amber-400/90">
            Время тренировки прошло — подтвердите завершение после сохранения
            листа.
          </p>
        )}

        {isTrainer ? (
          <div className="mt-3">
            <SessionLifecycleStrip
              session={session}
              dirty={dirty}
              draftCompleted={Boolean(draftWorkoutSheet.sessionCompleted)}
            />
          </div>
        ) : null}
      </div>

      {message && (
        <p className="rounded-xl bg-fitgo-500/10 px-3 py-2 text-sm text-fitgo-400">
          {message}
        </p>
      )}
      {error && (
        <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {isTrainer ? (
        <SessionContextStrip
          session={session}
          profileAge={profileAge}
          previous={previousMeta}
          primaryGoal={primaryGoal}
          onOpenGoals={() => setActiveTab('goals')}
        />
      ) : null}

      <SegmentedControl
        options={[
          { value: 'sheet', label: 'Лист' },
          { value: 'goals', label: 'Цели' },
        ]}
        value={activeTab}
        onChange={setActiveTab}
        layoutId="session-plan-tab"
      />

      {activeTab === 'sheet' ? (
        <div className="space-y-3">
          {!workoutSheetHasData(draftWorkoutSheet) && isTrainer && session.canEdit && (
            <button
              type="button"
              onClick={() => {
                const sheet = createEmptyWorkoutSheet();
                setDraftWorkoutSheet(
                  getWorkoutBlocks(sheet).includes('circuit')
                    ? ensureCircuitRoundLogs({
                        ...sheet,
                        circuit: createDefaultCircuit(),
                      })
                    : sheet,
                );
                setEditing(true);
              }}
              className="btn-primary w-full"
            >
              Открыть бланк тренировки
            </button>
          )}

          <WorkoutSheetEditor
            bookingId={bookingId}
            sheet={draftWorkoutSheet}
            sessionDate={session.startAt}
            clientName={session.clientName}
            clientDateOfBirth={session.clientDateOfBirth}
            clientRestingHr={session.clientRestingHr}
            canEdit={session.canEdit}
            isTrainer={isTrainer}
            hideLegacyTimer={formaLive}
            forma={formaLive}
            onChange={(sheet) => {
              setDraftWorkoutSheet(sheet);
              if (isTrainer) setEditing(true);
            }}
          />

          {isTrainer && session.canEdit && (
            <div className="space-y-1.5">
              <button
                disabled={busy || !dirty}
                onClick={() => void savePlan()}
                className="btn-primary w-full disabled:opacity-50"
              >
                {busy && dirty ? 'Сохранение…' : 'Сохранить лист'}
              </button>
              <p className="text-[11px] leading-snug text-slate-500">
                Фиксирует план и факт листа на сервере. Посещение в 1С и оплату
                не отмечает.
              </p>
            </div>
          )}
        </div>
      ) : (
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Цели и задачи</h3>
          {session.canEdit && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="text-sm text-fitgo-400"
            >
              Изменить
            </button>
          )}
        </div>

        {editing ? (
          <div className="space-y-4">
            {templates.length > 0 && (
              <div>
                <p className="mb-2 text-sm text-slate-400">Базовые цели:</p>
                <div className="flex flex-wrap gap-2">
                  {templates.map((tpl) => (
                    <button
                      key={tpl.title}
                      onClick={() => applyTemplate(tpl)}
                      className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300"
                    >
                      + {tpl.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {draftGoals.map((goal, goalIndex) => (
              <div
                key={goalIndex}
                className="rounded-xl bg-slate-800/50 p-3 space-y-2"
              >
                <input
                  className="input w-full"
                  placeholder="Цель тренировки"
                  value={goal.title}
                  onChange={(e) => {
                    const next = [...draftGoals];
                    next[goalIndex] = { ...goal, title: e.target.value };
                    setDraftGoals(next);
                  }}
                />
                <input
                  className="input w-full text-sm"
                  placeholder="Комментарий (необязательно)"
                  value={goal.notes ?? ''}
                  onChange={(e) => {
                    const next = [...draftGoals];
                    next[goalIndex] = { ...goal, notes: e.target.value };
                    setDraftGoals(next);
                  }}
                />
                {goal.tasks.map((task, taskIndex) => (
                  <input
                    key={taskIndex}
                    className="input w-full text-sm"
                    placeholder="Задача"
                    value={task.title}
                    onChange={(e) => {
                      const next = [...draftGoals];
                      const tasks = [...goal.tasks];
                      tasks[taskIndex] = { title: e.target.value };
                      next[goalIndex] = { ...goal, tasks };
                      setDraftGoals(next);
                    }}
                  />
                ))}
                <button
                  onClick={() => {
                    const next = [...draftGoals];
                    next[goalIndex] = {
                      ...goal,
                      tasks: [...goal.tasks, { title: '' }],
                    };
                    setDraftGoals(next);
                  }}
                  className="text-xs text-fitgo-400"
                >
                  + Задача
                </button>
                <button
                  onClick={() =>
                    setDraftGoals(draftGoals.filter((_, i) => i !== goalIndex))
                  }
                  className="ml-3 text-xs text-red-400"
                >
                  Удалить цель
                </button>
              </div>
            ))}

            <button
              onClick={() =>
                setDraftGoals([...draftGoals, { title: '', tasks: [{ title: '' }] }])
              }
              className="btn-secondary w-full"
            >
              Добавить цель
            </button>

            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={savePlan}
                className="btn-primary flex-1 disabled:opacity-50"
              >
                Сохранить план
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  load().catch(() => undefined);
                }}
                className="btn-secondary flex-1"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : session.goals.length === 0 ? (
          <div className="text-center text-sm text-slate-400">
            <p>План тренировки пока не задан</p>
            {session.canEdit && (
              <button
                onClick={() => setEditing(true)}
                className="btn-primary mt-3"
              >
                Задать цели
              </button>
            )}
          </div>
        ) : (
          <ul className="space-y-3">
            {session.goals.map((goal) => (
              <li key={goal.id} className="rounded-xl bg-slate-800/50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{goal.title}</p>
                    {goal.notes && (
                      <p className="text-sm text-slate-400">{goal.notes}</p>
                    )}
                  </div>
                  {showConfirmations && session.status !== 'COMPLETED' && (
                    <button
                      disabled={busy || myGoalConfirmed(goal)}
                      onClick={() => confirmGoal(goal.id)}
                      className={`shrink-0 rounded-full px-2 py-1 text-xs ${
                        myGoalConfirmed(goal)
                          ? 'bg-emerald-400/10 text-emerald-400'
                          : 'bg-slate-700 text-slate-300'
                      }`}
                    >
                      {myGoalConfirmed(goal) ? 'Подтверждено' : 'Выполнено'}
                    </button>
                  )}
                </div>
                {goal.tasks.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {goal.tasks.map((task) => (
                      <li
                        key={task.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="text-slate-300">· {task.title}</span>
                        {showConfirmations && session.status !== 'COMPLETED' && (
                          <button
                            disabled={
                              busy ||
                              (isClient
                                ? task.clientConfirmed
                                : task.trainerConfirmed)
                            }
                            onClick={() => confirmTask(task.id)}
                            className={`text-xs ${
                              (isClient
                                ? task.clientConfirmed
                                : task.trainerConfirmed)
                                ? 'text-emerald-400'
                                : 'text-slate-500'
                            }`}
                          >
                            {(isClient
                              ? task.clientConfirmed
                              : task.trainerConfirmed)
                              ? '✓'
                              : 'отметить'}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {showConfirmations && session.status !== 'COMPLETED' && (
                  <p className="mt-2 text-xs text-slate-500">
                    Клиент: {goal.clientConfirmed ? '✓' : '—'} · Тренер:{' '}
                    {goal.trainerConfirmed ? '✓' : '—'}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      )}

      {session.canComplete && (
        <div className="space-y-1.5">
          <button
            disabled={busy || (isTrainer && dirty)}
            onClick={() => void completeSession()}
            className="btn-primary w-full disabled:opacity-50"
          >
            Подтвердить завершение тренировки
          </button>
          <p className="text-[11px] leading-snug text-slate-500">
            {dirty
              ? 'Сначала сохраните лист — подтверждение не записывает черновик.'
              : session.ptControlApplies
                ? 'Отмечает проведение и передаёт запись администратору. Посещение в 1С не ставит.'
                : session.ptFlow === 'PERSONAL'
                  ? 'Отмечает проведение и один раз списывает пакет или фиксирует долг.'
                  : 'Отмечает проведение тренировки.'}
          </p>
        </div>
      )}

      {showRetryComplete ? (
        <div className="space-y-1.5">
          <button
            disabled={busy}
            onClick={() => void completeSession({ retry: true })}
            className="btn-secondary w-full disabled:opacity-50"
          >
            Повторить подтверждение
          </button>
          <p className="text-[11px] leading-snug text-slate-500">
            Доделывает незавершённый шаг. Повторный клик не создаёт второе
            списание или начисление.
          </p>
        </div>
      ) : null}

      {isTrainer ? (
        <SessionControlFollowUp
          bookingId={bookingId}
          session={session}
          onSessionRefresh={load}
        />
      ) : null}

      {isTrainer ? (
        <SessionNotesSheet
          open={notesOpen}
          onOpenChange={setNotesOpen}
          clientNotes={draftWorkoutSheet.notes ?? ''}
          privateNotes={draftWorkoutSheet.trainerPrivateNotes ?? ''}
          homeworkDraft={homeworkDraft}
          homeworkItems={homeworkItems}
          onChangeClient={(notes) => {
            setDraftWorkoutSheet((s) => ({ ...s, notes }));
            setEditing(true);
          }}
          onChangePrivate={(trainerPrivateNotes) => {
            setDraftWorkoutSheet((s) => ({ ...s, trainerPrivateNotes }));
            setEditing(true);
          }}
          onChangeHomework={setHomeworkDraft}
          onChangeHomeworkItems={setHomeworkItems}
          activeHomeworkProgress={activeHomeworkProgress}
          onRepeatPrevious={async () => {
            const token = getToken();
            if (!token) return;
            const prev = await api.trainerPreviousHomework(
              token,
              session.clientId,
            );
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
          }}
          busy={busy}
          onSave={async () => {
            await savePlan();
            const hasHw =
              Boolean(homeworkDraft.trim()) || homeworkItems.length > 0;
            if (hasHw) {
              const token = getToken();
              if (token) {
                try {
                  await api.trainerCreateHomework(token, {
                    clientId: session.clientId,
                    bookingId,
                    summary: homeworkDraft.trim() || undefined,
                    items:
                      homeworkItems.length > 0
                        ? homeworkItems.map((i) => ({
                            kind: i.kind,
                            title: i.title,
                            target: i.target,
                            timesRequired: i.timesRequired,
                          }))
                        : undefined,
                  });
                  setMessage('Заметки и задание сохранены');
                  await loadActiveHomework(session.clientId);
                } catch {
                  setMessage('Заметки сохранены; задание — позже');
                }
              }
            }
            setNotesOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
