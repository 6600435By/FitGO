'use client';

import type {
  TrainerClientDetail,
  TrainerClientProgress,
} from '@fitgo/shared-types';
import {
  BODY_LIMITATION_LABELS,
  CLIENT_PRIMARY_GOAL_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  HOME_EQUIPMENT_LABELS,
  PREFERRED_INTENSITY_LABELS,
  PREFERRED_MODALITY_LABELS,
  PREFERRED_TIME_LABELS,
  type BodyLimitationZone,
  type ClientPrimaryGoal,
  type ExperienceLevel,
  type HomeEquipmentItem,
  type PreferredIntensity,
  type PreferredModality,
  type PreferredTimeOfDay,
} from '@fitgo/shared-types';
import { MiniBars, SegmentedControl, Sparkline } from '@fitgo/forma-ui';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import {
  formatDate,
  formatDateTime,
  membershipStatusLabel,
  sessionStatusColor,
  sessionStatusLabel,
} from '@/lib/utils';

type Tab = 'overview' | 'sessions' | 'progress' | 'notes' | 'anketa';

function labelList<T extends string>(
  values: T[],
  labels: Record<T, string>,
): string {
  if (!values.length) return '—';
  return values.map((v) => labels[v] ?? v).join(', ');
}

function messageTemplates(client: TrainerClientDetail) {
  const name = client.firstName;
  return [
    {
      id: 'renew',
      label: 'Продление',
      text: `${name}, пакет скоро закончится — давайте продлим, чтобы не терять ритм тренировок.`,
    },
    {
      id: 'missed',
      label: 'Давно не видел',
      text: `${name}, давно не виделись в зале — как самочувствие? Готов подобрать удобное время.`,
    },
    {
      id: 'bday',
      label: 'День рождения',
      text: `${name}, с днём рождения! Пусть этот год будет сильным — жду на тренировке.`,
    },
  ] as const;
}

export default function TrainerClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [client, setClient] = useState<TrainerClientDetail | null>(null);
  const [progress, setProgress] = useState<TrainerClientProgress | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
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

  useEffect(() => {
    if (tab !== 'progress' || !id) return;
    const token = getToken();
    if (!token) return;
    api
      .trainerClientProgress(token, id)
      .then(setProgress)
      .catch(() => setProgress(null));
  }, [tab, id]);

  const templates = useMemo(
    () => (client ? messageTemplates(client) : []),
    [client],
  );

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

  const sendTemplate = async (text: string) => {
    const token = getToken();
    if (!token) return;
    try {
      await api.trainerSendMessage(token, id, text);
      setFeedback('Сообщение отправлено');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Не удалось отправить');
    }
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
      <div className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">
              {client.firstName} {client.lastName}
            </h2>
            {client.phone && (
              <p className="text-sm text-slate-400">{client.phone}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/trainer/schedule?clientId=${id}`}
              className="btn-secondary text-sm"
            >
              Записать
            </Link>
            <Link
              href={`/trainer/messages?clientId=${id}`}
              className="btn-primary text-sm"
            >
              Написать
            </Link>
          </div>
        </div>

        {client.crmStatus === 'PENDING_CRM' && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Нет карточки 1С — заведите клиента и штрихкод в CRM по телефону
            {client.phone ? ` ${client.phone}` : ''}.
          </p>
        )}
        {client.membershipName && (
          <p className="text-sm">
            {client.membershipName}
            {client.membershipStatus &&
              ` · ${membershipStatusLabel(client.membershipStatus)}`}
            {client.sessionsRemaining != null
              ? ` · осталось ${client.sessionsRemaining}`
              : ''}
            {client.membershipValidUntil
              ? ` · до ${formatDate(client.membershipValidUntil)}`
              : ''}
          </p>
        )}
        {client.ownLedger && (
          <div className="rounded-xl border border-forma-500/20 bg-forma-500/5 px-3 py-2 text-sm">
            <p className="font-medium text-forma-100">Личный учёт</p>
            {client.ownLedger.activePackage ? (
              <p className="mt-1 text-forma-200">
                {client.ownLedger.activePackage.title}: осталось{' '}
                {client.ownLedger.activePackage.sessionsRemaining} из{' '}
                {client.ownLedger.activePackage.sessionsTotal}
                {client.ownLedger.activePackage.validUntil
                  ? ` · до ${formatDate(client.ownLedger.activePackage.validUntil)}`
                  : ''}
              </p>
            ) : (
              <p className="mt-1 text-forma-400">Нет активного пакета</p>
            )}
            {client.ownLedger.debtMinor > 0 && (
              <p className="mt-1 text-amber-200">
                Долг:{' '}
                {(client.ownLedger.debtMinor / 100).toLocaleString('ru-RU', {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                })}{' '}
                BYN
              </p>
            )}
            <Link
              href="/trainer/my-payments"
              className="mt-2 inline-block text-xs text-forma-400 underline"
            >
              Мои оплаты
            </Link>
          </div>
        )}
        <p className="text-xs text-slate-500">
          {[
            client.lastVisit
              ? `ПТ: ${formatDate(client.lastVisit)}`
              : null,
            client.lastHallVisit
              ? `зал: ${formatDate(client.lastHallVisit)}`
              : null,
            client.visitFrequencyPerWeek != null
              ? `${client.visitFrequencyPerWeek}×/нед`
              : null,
            (client.cancelNoShowCount ?? 0) > 0
              ? `отмен/неявок: ${client.cancelNoShowCount}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'Нет визитов'}
        </p>
      </div>

      <SegmentedControl
        layoutId="trainer-client-tabs"
        size="sm"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'overview', label: 'Обзор' },
          { value: 'sessions', label: 'Тренировки' },
          { value: 'progress', label: 'Прогресс' },
          { value: 'notes', label: 'Заметки' },
          { value: 'anketa', label: 'Анкета' },
        ]}
      />

      {tab === 'overview' && (
        <>
          <div className="card space-y-2">
            <h3 className="font-semibold">Шаблоны сообщений</h3>
            <div className="flex flex-wrap gap-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={() => sendTemplate(t.text)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 className="mb-3 font-semibold">Цели тренера</h3>
            {client.goals.length === 0 ? (
              <p className="text-sm text-slate-400">Нет целей</p>
            ) : (
              <ul className="mb-3 space-y-2">
                {client.goals.map((g) => (
                  <li
                    key={g.id}
                    className="rounded-xl bg-slate-800/50 px-3 py-2 text-sm"
                  >
                    <p className="font-medium">{g.title}</p>
                    {g.target && (
                      <p className="text-slate-400">Цель: {g.target}</p>
                    )}
                    {g.progress && (
                      <p className="text-fitgo-400">{g.progress}</p>
                    )}
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
            <h3 className="mb-3 font-semibold">Замер</h3>
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
        </>
      )}

      {tab === 'sessions' && (
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
                      <p className="text-slate-400">
                        {formatDateTime(s.startAt)}
                      </p>
                      {s.hasWorkoutSheet && (
                        <p className="text-xs text-fitgo-400">
                          Тренировочный лист заполнен
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
      )}

      {tab === 'progress' && (
        <div className="card space-y-4">
          <h3 className="font-semibold">Прогресс</h3>
          {!progress ? (
            <p className="text-sm text-slate-400">Загрузка…</p>
          ) : (
            <>
              {progress.weightSeries.length > 1 ? (
                <div>
                  <p className="mb-2 text-sm text-slate-400">Вес</p>
                  <Sparkline
                    values={progress.weightSeries.map((p) => p.weightKg)}
                    className="h-16 w-full"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    {progress.weightSeries[0]?.weightKg} →{' '}
                    {
                      progress.weightSeries[progress.weightSeries.length - 1]
                        ?.weightKg
                    }{' '}
                    кг
                  </p>
                </div>
              ) : (
                <p className="text-sm text-slate-400">Мало замеров веса</p>
              )}
              {progress.visitFrequency.length > 0 ? (
                <div>
                  <p className="mb-2 text-sm text-slate-400">
                    Частота ПТ по неделям
                  </p>
                  <MiniBars
                    values={progress.visitFrequency.map((w) => w.count)}
                    className="h-20 w-full"
                  />
                </div>
              ) : (
                <p className="text-sm text-slate-400">Нет данных по частоте</p>
              )}
              {client.measurements.length > 0 && (
                <ul className="space-y-1 text-sm text-slate-400">
                  {client.measurements.map((m) => (
                    <li key={m.id}>
                      {formatDate(m.recordedAt)}
                      {m.weight ? ` · ${m.weight} кг` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'notes' && (
        <div className="card">
          <h3 className="mb-3 font-semibold">Заметки</h3>
          {client.notes.map((n) => (
            <p
              key={n.id}
              className="mb-2 rounded-xl bg-slate-800/50 px-3 py-2 text-sm"
            >
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
      )}

      {tab === 'anketa' && (
        <div className="card space-y-3">
          <h3 className="font-semibold">Анкета клиента</h3>
          {!client.questionnaire ? (
            <p className="text-sm text-slate-400">Анкета ещё не заполнена</p>
          ) : (
            (() => {
              const q = client.questionnaire!;
              const t = q.training;
              return (
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-400">Цели</dt>
                    <dd className="text-right">
                      {labelList(
                        (t?.primaryGoals ?? []) as ClientPrimaryGoal[],
                        CLIENT_PRIMARY_GOAL_LABELS,
                      )}
                    </dd>
                  </div>
                  {t?.goalNotes && (
                    <p className="rounded-lg bg-slate-800/50 px-3 py-2 text-slate-300">
                      {t.goalNotes}
                    </p>
                  )}
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-400">Опыт</dt>
                    <dd className="text-right">
                      {t?.experienceLevel
                        ? EXPERIENCE_LEVEL_LABELS[
                            t.experienceLevel as ExperienceLevel
                          ]
                        : '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-400">Форматы</dt>
                    <dd className="text-right">
                      {labelList(
                        (t?.preferredModalities ?? []) as PreferredModality[],
                        PREFERRED_MODALITY_LABELS,
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-400">Ограничения</dt>
                    <dd className="text-right">
                      {labelList(
                        (t?.limitations ?? []) as BodyLimitationZone[],
                        BODY_LIMITATION_LABELS,
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-400">Предпочтения</dt>
                    <dd className="text-right">
                      {[
                        t?.preferredSessionMin
                          ? `${t.preferredSessionMin} мин`
                          : null,
                        t?.preferredTimeOfDay
                          ? PREFERRED_TIME_LABELS[
                              t.preferredTimeOfDay as PreferredTimeOfDay
                            ]
                          : null,
                        t?.preferredIntensity
                          ? PREFERRED_INTENSITY_LABELS[
                              t.preferredIntensity as PreferredIntensity
                            ]
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </dd>
                  </div>
                  {(t?.homeEquipment?.length ?? 0) > 0 && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-400">Дома</dt>
                      <dd className="text-right">
                        {labelList(
                          t!.homeEquipment as HomeEquipmentItem[],
                          HOME_EQUIPMENT_LABELS,
                        )}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3 border-t border-slate-800 pt-2">
                    <dt className="text-slate-400">Тело</dt>
                    <dd className="text-right">
                      {[
                        q.body.heightCm != null
                          ? `${q.body.heightCm} см`
                          : null,
                        q.body.latestWeightKg != null
                          ? `${q.body.latestWeightKg} кг`
                          : null,
                        q.body.targetWeightKg != null
                          ? `цель ${q.body.targetWeightKg} кг`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </dd>
                  </div>
                </dl>
              );
            })()
          )}
        </div>
      )}

      {feedback && (
        <p className="rounded-xl bg-fitgo-500/10 px-3 py-2 text-sm text-fitgo-400">
          {feedback}
        </p>
      )}
    </div>
  );
}
