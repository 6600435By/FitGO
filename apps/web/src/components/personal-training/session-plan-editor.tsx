'use client';

import type {
  PersonalTrainingGoalTemplate,
  PersonalTrainingSessionDetail,
  PersonalTrainingSessionGoal,
  WorkoutSheet,
} from '@fitgo/shared-types';
import {
  createEmptyWorkoutSheet,
  createDefaultCircuit,
  ensureCircuitRoundLogs,
  getWorkoutBlocks,
  normalizeWorkoutSheet,
  workoutSheetHasData,
} from '@fitgo/shared-types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import {
  formatDateTime,
  sessionStatusColor,
  sessionStatusLabel,
} from '@/lib/utils';
import { WorkoutSheetEditor } from './workout-sheet-editor';

type DraftGoal = {
  id?: string;
  title: string;
  notes?: string;
  tasks: Array<{ id?: string; title: string }>;
};

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

  const load = async () => {
    const token = getToken();
    if (!token) return;
    const data = await api.personalSessionDetail(token, bookingId);
    setSession(data);
    setDraftGoals(
      data.goals.map((g) => ({
        id: g.id,
        title: g.title,
        notes: g.notes,
        tasks: g.tasks.map((t) => ({ id: t.id, title: t.title })),
      })),
    );
    setDraftWorkoutSheet(normalizeWorkoutSheet(data.workoutSheet));
  };

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    Promise.all([
      api.personalSessionDetail(token, bookingId),
      api.personalGoalTemplates(token),
    ])
      .then(([data, tpls]) => {
        setSession(data);
        setTemplates(tpls);
        setDraftGoals(
          data.goals.map((g) => ({
            id: g.id,
            title: g.title,
            notes: g.notes,
            tasks: g.tasks.map((t) => ({ id: t.id, title: t.title })),
          })),
        );
        setDraftWorkoutSheet(normalizeWorkoutSheet(data.workoutSheet));
      })
      .catch((err) => setError(err.message));
  }, [bookingId]);

  const savePlan = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setMessage('');
    try {
      const data = await api.personalSessionUpdatePlan(token, bookingId, {
        goals: draftGoals.filter((g) => g.title.trim()),
        workoutSheet: ensureCircuitRoundLogs(draftWorkoutSheet),
      });
      setSession(data);
      setDraftWorkoutSheet(normalizeWorkoutSheet(data.workoutSheet));
      setEditing(false);
      setMessage('План тренировки сохранён');
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

  const completeSession = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      const data = await api.personalSessionComplete(token, bookingId);
      setSession(data);
      setMessage('Тренировка завершена');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const isClient = viewerRole === 'client';
  const isTrainer = !isClient;
  const counterpartName = isClient
    ? session?.trainerName
    : session?.clientName;

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

  return (
    <div className="space-y-4">
      <Link href={backHref} className="text-sm text-fitgo-400">
        ← {backLabel}
      </Link>

      <div className="card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Персональная тренировка</h2>
            <p className="mt-1 text-sm text-slate-400">
              {formatDateTime(session.startAt)} · {counterpartName}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-1 text-xs ${sessionStatusColor(session.status)}`}
          >
            {sessionStatusLabel(session.status)}
          </span>
        </div>

        {session.status === 'COMPLETED' && (
          <p className="mt-3 text-sm text-slate-400">
            {session.clientCompletedAt && 'Клиент подтвердил завершение · '}
            {session.trainerCompletedAt && 'Тренер подтвердил завершение'}
            {!session.clientCompletedAt && !session.trainerCompletedAt &&
              'Тренировка завершена'}
          </p>
        )}
        {session.status === 'AWAITING_CONFIRMATION' && (
          <p className="mt-3 text-sm text-amber-400/90">
            Время тренировки прошло — подтвердите завершение (достаточно одной
            стороны).
          </p>
        )}
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

      <div className="flex gap-2 rounded-xl bg-slate-800/50 p-1">
        <button
          type="button"
          onClick={() => setActiveTab('sheet')}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${
            activeTab === 'sheet'
              ? 'bg-fitgo-500 text-white'
              : 'text-slate-400'
          }`}
        >
          Тренировочный лист
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('goals')}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${
            activeTab === 'goals'
              ? 'bg-fitgo-500 text-white'
              : 'text-slate-400'
          }`}
        >
          Цели и задачи
        </button>
      </div>

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
            canEdit={session.canEdit}
            isTrainer={isTrainer}
            onChange={(sheet) => {
              setDraftWorkoutSheet(sheet);
              if (isTrainer) setEditing(true);
            }}
            onResetTemplate={
              isTrainer && session.canEdit
                ? () => {
                    setDraftWorkoutSheet(createEmptyWorkoutSheet());
                    setEditing(true);
                  }
                : undefined
            }
          />

          {isTrainer && session.canEdit && (
            <button
              disabled={busy}
              onClick={savePlan}
              className="btn-primary w-full disabled:opacity-50"
            >
              {busy ? 'Сохранение…' : 'Сохранить лист'}
            </button>
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
        <button
          disabled={busy}
          onClick={completeSession}
          className="btn-primary w-full disabled:opacity-50"
        >
          Подтвердить завершение тренировки
        </button>
      )}
    </div>
  );
}
