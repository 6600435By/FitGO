'use client';

import type { TrainerClientDetail } from '@fitgo/shared-types';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import {
  formatDate,
  formatDateTime,
  membershipStatusLabel,
  sessionStatusColor,
  sessionStatusLabel,
} from '@/lib/utils';

export default function TrainerClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [client, setClient] = useState<TrainerClientDetail | null>(null);
  const [note, setNote] = useState('');
  const [goalTitle, setGoalTitle] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [weight, setWeight] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    const token = getToken();
    if (!token || !id) return;
    api
      .trainerClient(token, id)
      .then(setClient)
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    load();
  }, [id]);

  const addNote = async () => {
    const token = getToken();
    if (!token || !note.trim()) return;
    await api.trainerAddNote(token, id, note);
    setNote('');
    setFeedback('Заметка добавлена');
    load();
  };

  const addGoal = async () => {
    const token = getToken();
    if (!token || !goalTitle.trim()) return;
    await api.trainerAddGoal(token, id, {
      title: goalTitle,
      target: goalTarget || undefined,
    });
    setGoalTitle('');
    setGoalTarget('');
    setFeedback('Цель добавлена');
    load();
  };

  const addMeasurement = async () => {
    const token = getToken();
    if (!token) return;
    await api.trainerAddMeasurement(token, id, {
      weight: weight ? parseFloat(weight) : undefined,
    });
    setWeight('');
    setFeedback('Замер сохранён');
    load();
  };

  if (error) return <p className="text-red-400">{error}</p>;

  if (!client) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="text-xl font-semibold">
          {client.firstName} {client.lastName}
        </h2>
        {client.crmStatus === 'PENDING_CRM' && (
          <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Нет карточки 1С — заведите клиента и штрихкод в CRM по телефону
            {client.phone ? ` ${client.phone}` : ''}.
          </p>
        )}
        {client.crmStatus === 'LINKED' && (
          <p className="mt-1 text-xs text-slate-500">CRM: привязан</p>
        )}
        {client.membershipName && (
          <p className="mt-2 text-sm">
            {client.membershipName}
            {client.membershipStatus &&
              ` · ${membershipStatusLabel(client.membershipStatus)}`}
          </p>
        )}
        {client.lastVisit && (
          <p className="text-sm text-slate-400">
            Последняя тренировка: {formatDate(client.lastVisit)}
          </p>
        )}
      </div>

      <div className="card">
        <h3 className="mb-3 font-semibold">Цели</h3>
        {client.goals.length === 0 ? (
          <p className="text-sm text-slate-400">Нет целей</p>
        ) : (
          <ul className="mb-3 space-y-2">
            {client.goals.map((g) => (
              <li key={g.id} className="rounded-xl bg-slate-800/50 px-3 py-2 text-sm">
                <p className="font-medium">{g.title}</p>
                {g.target && <p className="text-slate-400">Цель: {g.target}</p>}
                {g.progress && <p className="text-fitgo-400">{g.progress}</p>}
              </li>
            ))}
          </ul>
        )}
        <input
          className="input mb-2 w-full"
          placeholder="Новая цель"
          value={goalTitle}
          onChange={(e) => setGoalTitle(e.target.value)}
        />
        <input
          className="input mb-2 w-full"
          placeholder="Целевое значение"
          value={goalTarget}
          onChange={(e) => setGoalTarget(e.target.value)}
        />
        <button onClick={addGoal} className="btn-secondary w-full">
          Добавить цель
        </button>
      </div>

      <div className="card">
        <h3 className="mb-3 font-semibold">Заметки</h3>
        {client.notes.map((n) => (
          <p key={n.id} className="mb-2 rounded-xl bg-slate-800/50 px-3 py-2 text-sm">
            {n.content}
          </p>
        ))}
        <textarea
          className="input mb-2 w-full"
          placeholder="Добавить заметку..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
        />
        <button onClick={addNote} className="btn-secondary w-full">
          Сохранить заметку
        </button>
      </div>

      <div className="card">
        <h3 className="mb-3 font-semibold">История тренировок</h3>
        {client.sessions.length === 0 ? (
          <p className="text-sm text-slate-400">
            Нет персональных тренировок с этим клиентом
          </p>
        ) : (
          <ul className="space-y-2">
            {client.sessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/trainer/sessions/${s.id}?clientId=${id}`}
                  className="flex items-start justify-between rounded-xl bg-slate-800/50 px-3 py-2 text-sm transition hover:bg-slate-800"
                >
                  <div>
                    <p className="font-medium">Персональная тренировка</p>
                    <p className="text-slate-400">{formatDateTime(s.startAt)}</p>
                    {s.goalsCount > 0 && (
                      <p className="text-xs text-slate-500">
                        {s.goalsCount} {s.goalsCount === 1 ? 'цель' : 'целей'}
                      </p>
                    )}
                    {s.hasWorkoutSheet && (
                      <p className="text-xs text-fitgo-400">Тренировочный лист заполнен</p>
                    )}
                    {s.awaitingConfirmation && (
                      <p className="text-xs text-amber-400">
                        Ожидает подтверждения
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-1 text-xs ${sessionStatusColor(s.status)}`}
                  >
                    {sessionStatusLabel(s.status)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h3 className="mb-3 font-semibold">Замеры</h3>
        {client.measurements.map((m) => (
          <p key={m.id} className="mb-2 text-sm text-slate-400">
            {formatDate(m.recordedAt)}
            {m.weight ? ` · ${m.weight} кг` : ''}
            {m.notes ? ` · ${m.notes}` : ''}
          </p>
        ))}
        <input
          className="input mb-2 w-full"
          type="number"
          placeholder="Вес (кг)"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
        />
        <button onClick={addMeasurement} className="btn-secondary w-full">
          Записать замер
        </button>
      </div>

      <Link
        href={`/trainer/messages?clientId=${id}`}
        className="card block border-fitgo-500/30 bg-fitgo-500/5"
      >
        <p className="font-medium text-fitgo-300">Открыть чат с клиентом</p>
        <p className="mt-1 text-sm text-slate-400">
          Переписка в формате диалога
        </p>
      </Link>

      {feedback && (
        <p className="rounded-xl bg-fitgo-500/10 px-3 py-2 text-sm text-fitgo-400">
          {feedback}
        </p>
      )}
    </div>
  );
}
