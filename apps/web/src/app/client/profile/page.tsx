'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  BODY_LIMITATION_LABELS,
  CLIENT_PRIMARY_GOAL_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  GOAL_HORIZON_OPTIONS,
  HOME_EQUIPMENT_LABELS,
  PREFERRED_INTENSITY_LABELS,
  PREFERRED_MODALITY_LABELS,
  PREFERRED_TIME_LABELS,
  emptyTrainingProfile,
  trainingProfileCompleteness,
  type BodyLimitationZone,
  type BodyProfileResponse,
  type ClientPrimaryGoal,
  type ClientProfile,
  type ClientTrainingProfile,
  type ExperienceLevel,
  type HomeEquipmentItem,
  type PreferredIntensity,
  type PreferredModality,
  type PreferredTimeOfDay,
} from '@fitgo/shared-types';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

type Tab =
  | 'account'
  | 'goals'
  | 'body'
  | 'training'
  | 'limits'
  | 'prefs'
  | 'rating';

function toggleInList<T extends string>(list: T[], value: T, exclusive?: T): T[] {
  if (exclusive && value === exclusive) return [exclusive];
  const withoutExclusive = exclusive
    ? list.filter((v) => v !== exclusive)
    : list;
  if (withoutExclusive.includes(value)) {
    return withoutExclusive.filter((v) => v !== value);
  }
  return [...withoutExclusive, value];
}

function Chip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm ${
        active ? 'bg-fitgo-500 text-white' : 'bg-slate-800 text-slate-300'
      }`}
    >
      {label}
    </button>
  );
}

export default function ClientProfilePage() {
  const [tab, setTab] = useState<Tab>('account');
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [training, setTraining] = useState<ClientTrainingProfile>(
    emptyTrainingProfile(),
  );
  const [body, setBody] = useState<BodyProfileResponse | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [nickname, setNickname] = useState('');
  const [useRealName, setUseRealName] = useState(true);
  const [bodyForm, setBodyForm] = useState({
    heightCm: '',
    targetWeightKg: '',
    weightKg: '',
    chestCm: '',
    waistCm: '',
    hipsCm: '',
    bicepsCm: '',
    thighCm: '',
    bodyFatPct: '',
  });
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editLogForm, setEditLogForm] = useState({
    weightKg: '',
    chestCm: '',
    waistCm: '',
    hipsCm: '',
    bicepsCm: '',
    thighCm: '',
    bodyFatPct: '',
  });
  const [savingTraining, setSavingTraining] = useState(false);

  const token = getToken();

  const loadProfile = () => {
    if (!token) return;
    api
      .clientProfile(token)
      .then((p) => {
        setProfile(p);
        setTraining(p.training ?? emptyTrainingProfile());
        setNickname(p.gamificationNickname ?? '');
        setUseRealName(p.useRealNameInPublic ?? true);
      })
      .catch((e) => setError(e.message));
  };

  const loadBody = () => {
    if (!token) return;
    api.bodyProfile(token).then(setBody).catch(() => {});
  };

  useEffect(() => {
    loadProfile();
    loadBody();
  }, [token]);

  useEffect(() => {
    if (body?.profile) {
      setBodyForm((prev) => ({
        ...prev,
        heightCm: body.profile.heightCm?.toString() ?? '',
        targetWeightKg: body.profile.targetWeightKg?.toString() ?? '',
      }));
    }
  }, [body]);

  const latestWeightKg = body?.logs.find((l) => l.weightKg != null)?.weightKg;

  const completeness = useMemo(() => {
    const trainPct = trainingProfileCompleteness(training);
    const hasBody = !!(body?.profile.heightCm || body?.logs.some((l) => l.weightKg));
    const hasAccount = !!(
      profile?.firstName &&
      profile?.lastName &&
      profile?.phone &&
      profile?.dateOfBirth
    );
    let score = 0;
    if (hasAccount) score += 20;
    if (training.primaryGoals.length > 0) score += 20;
    if (hasBody) score += 20;
    score += Math.round(trainPct * 0.4);
    return Math.min(100, score);
  }, [profile, training, body]);

  const saveProfile = async () => {
    if (!token || !profile) return;
    setError('');
    try {
      await api.updateClientProfile(token, {
        firstName: profile.firstName,
        lastName: profile.lastName,
        phone: profile.phone ?? '',
        gender: profile.gender ?? 'MALE',
        dateOfBirth: profile.dateOfBirth ?? '',
      });
      setMsg('Аккаунт сохранён');
      loadProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  /** Persist patch without wiping unsaved fields in other sections. */
  const saveTraining = async (
    nextLocal: ClientTrainingProfile,
    patch: Partial<ClientTrainingProfile>,
  ) => {
    if (!token) return;
    setTraining(nextLocal);
    setError('');
    setSavingTraining(true);
    try {
      const saved = await api.updateTrainingProfile(token, patch);
      setTraining((prev) => {
        const merged = { ...prev };
        (Object.keys(patch) as (keyof ClientTrainingProfile)[]).forEach((key) => {
          (merged as Record<string, unknown>)[key] = saved[key];
        });
        if (saved.updatedAt) merged.updatedAt = saved.updatedAt;
        return merged;
      });
      setMsg('Сохранено');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения');
      loadProfile();
    } finally {
      setSavingTraining(false);
    }
  };

  const saveBodyBaseline = async () => {
    if (!token) return;
    setError('');
    try {
      await api.updateBodyProfile(token, {
        heightCm: bodyForm.heightCm ? Number(bodyForm.heightCm) : null,
        targetWeightKg: bodyForm.targetWeightKg
          ? Number(bodyForm.targetWeightKg)
          : null,
      });
      setMsg('Рост и цель веса сохранены');
      loadBody();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const saveBodyLog = async () => {
    if (!token) return;
    setError('');
    try {
      const logPayload = {
        weightKg: bodyForm.weightKg ? Number(bodyForm.weightKg) : undefined,
        chestCm: bodyForm.chestCm ? Number(bodyForm.chestCm) : undefined,
        waistCm: bodyForm.waistCm ? Number(bodyForm.waistCm) : undefined,
        hipsCm: bodyForm.hipsCm ? Number(bodyForm.hipsCm) : undefined,
        bicepsCm: bodyForm.bicepsCm ? Number(bodyForm.bicepsCm) : undefined,
        thighCm: bodyForm.thighCm ? Number(bodyForm.thighCm) : undefined,
        bodyFatPct: bodyForm.bodyFatPct ? Number(bodyForm.bodyFatPct) : undefined,
      };
      if (!Object.values(logPayload).some((v) => v != null && !Number.isNaN(v))) {
        setError('Укажите хотя бы один замер');
        return;
      }
      await api.addBodyLog(token, logPayload);
      setBodyForm((prev) => ({
        ...prev,
        weightKg: '',
        chestCm: '',
        waistCm: '',
        hipsCm: '',
        bicepsCm: '',
        thighCm: '',
        bodyFatPct: '',
      }));
      setMsg('Замеры сохранены');
      loadBody();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const startEditLog = (log: NonNullable<BodyProfileResponse['logs']>[number]) => {
    setEditingLogId(log.id);
    setEditLogForm({
      weightKg: log.weightKg?.toString() ?? '',
      chestCm: log.chestCm?.toString() ?? '',
      waistCm: log.waistCm?.toString() ?? '',
      hipsCm: log.hipsCm?.toString() ?? '',
      bicepsCm: log.bicepsCm?.toString() ?? '',
      thighCm: log.thighCm?.toString() ?? '',
      bodyFatPct: log.bodyFatPct?.toString() ?? '',
    });
    setMsg('');
    setError('');
  };

  const saveEditLog = async () => {
    if (!token || !editingLogId) return;
    setError('');
    try {
      await api.updateBodyLog(token, editingLogId, {
        weightKg: editLogForm.weightKg ? Number(editLogForm.weightKg) : null,
        chestCm: editLogForm.chestCm ? Number(editLogForm.chestCm) : null,
        waistCm: editLogForm.waistCm ? Number(editLogForm.waistCm) : null,
        hipsCm: editLogForm.hipsCm ? Number(editLogForm.hipsCm) : null,
        bicepsCm: editLogForm.bicepsCm ? Number(editLogForm.bicepsCm) : null,
        thighCm: editLogForm.thighCm ? Number(editLogForm.thighCm) : null,
        bodyFatPct: editLogForm.bodyFatPct ? Number(editLogForm.bodyFatPct) : null,
      });
      setEditingLogId(null);
      setMsg('Запись обновлена');
      loadBody();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const deleteLog = async (id: string) => {
    if (!token) return;
    if (!window.confirm('Удалить эту запись замеров?')) return;
    setError('');
    try {
      await api.deleteBodyLog(token, id);
      if (editingLogId === id) setEditingLogId(null);
      setMsg('Запись удалена');
      loadBody();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const suggestNick = async () => {
    if (!token) return;
    const { nickname: n } = await api.suggestNickname(token);
    setNickname(n);
  };

  const activate = async () => {
    if (!token) return;
    if (!useRealName && nickname.length < 2) {
      setError('Выберите ник или используйте реальное имя');
      return;
    }
    if (!useRealName) {
      const check = await api.checkNickname(token, nickname);
      if (!check.available) {
        setError('Ник занят, выберите другой');
        return;
      }
    }
    if (profile?.gamificationStartedAt) {
      await api.updateGamificationSettings(token, {
        useRealNameInPublic: useRealName,
        gamificationNickname: useRealName ? undefined : nickname,
      });
      setMsg('Настройки рейтинга обновлены');
    } else {
      await api.activateGamification(token, {
        useRealNameInPublic: useRealName,
        gamificationNickname: useRealName ? undefined : nickname,
      });
      setMsg('Геймификация активирована!');
      loadProfile();
    }
  };

  if (!profile) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'account', label: 'Аккаунт' },
    { id: 'goals', label: 'Цели' },
    { id: 'body', label: 'Тело' },
    { id: 'training', label: 'Опыт' },
    { id: 'limits', label: 'Ограничения' },
    { id: 'prefs', label: 'Предпочтения' },
    { id: 'rating', label: 'Рейтинг' },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Профиль</h2>
        <p className="text-sm text-slate-400">
          Анкета для тренировок — видна вам и тренеру
        </p>
      </div>

      <div className="card space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">Заполнено</span>
          <span className="font-medium text-fitgo-400">{completeness}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-fitgo-500 transition-all"
            style={{ width: `${completeness}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setMsg('');
              setError('');
              setEditingLogId(null);
            }}
            className={`rounded-lg px-3 py-2 text-center text-xs font-medium leading-snug ${
              tab === t.id ? 'bg-fitgo-500 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {savingTraining && (
        <p className="text-xs text-slate-500">Сохранение анкеты…</p>
      )}

      {msg && <p className="text-sm text-fitgo-400">{msg}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {tab === 'account' && (
        <div className="card space-y-3">
          <input
            className="input"
            placeholder="Имя"
            value={profile.firstName}
            onChange={(e) => setProfile({ ...profile, firstName: e.target.value })}
          />
          <input
            className="input"
            placeholder="Фамилия"
            value={profile.lastName}
            onChange={(e) => setProfile({ ...profile, lastName: e.target.value })}
          />
          <input
            className="input"
            placeholder="Телефон"
            value={profile.phone ?? ''}
            onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
          />
          <select
            className="input"
            value={profile.gender ?? 'MALE'}
            onChange={(e) => setProfile({ ...profile, gender: e.target.value })}
          >
            <option value="MALE">Мужской</option>
            <option value="FEMALE">Женский</option>
            <option value="OTHER">Другой</option>
          </select>
          <input
            className="input"
            type="date"
            value={profile.dateOfBirth ?? ''}
            onChange={(e) => setProfile({ ...profile, dateOfBirth: e.target.value })}
          />
          <button type="button" onClick={saveProfile} className="btn-primary w-full">
            Сохранить
          </button>
        </div>
      )}

      {tab === 'goals' && (
        <div className="card space-y-4">
          <p className="text-sm text-slate-400">
            Выберите 1–2 главные цели — сохраняется сразу
          </p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CLIENT_PRIMARY_GOAL_LABELS) as ClientPrimaryGoal[]).map(
              (g) => (
                <Chip
                  key={g}
                  label={CLIENT_PRIMARY_GOAL_LABELS[g]}
                  active={training.primaryGoals.includes(g)}
                  onClick={() => {
                    let nextGoals = toggleInList(training.primaryGoals, g);
                    if (nextGoals.length > 2) nextGoals = nextGoals.slice(-2);
                    const next = { ...training, primaryGoals: nextGoals };
                    void saveTraining(next, { primaryGoals: nextGoals });
                  }}
                />
              ),
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-400">Горизонт</label>
            <div className="flex flex-wrap gap-2">
              {GOAL_HORIZON_OPTIONS.map((w) => (
                <Chip
                  key={w}
                  label={`${w} нед.`}
                  active={training.goalHorizonWeeks === w}
                  onClick={() => {
                    const horizon = training.goalHorizonWeeks === w ? null : w;
                    const next = { ...training, goalHorizonWeeks: horizon };
                    void saveTraining(next, {
                      goalHorizonWeeks: horizon,
                    });
                  }}
                />
              ))}
            </div>
          </div>
          <textarea
            className="input min-h-[80px]"
            placeholder="Комментарий к цели (необязательно)"
            value={training.goalNotes ?? ''}
            onChange={(e) => setTraining({ ...training, goalNotes: e.target.value })}
            onBlur={(e) => {
              const goalNotes = e.target.value;
              void saveTraining(
                { ...training, goalNotes },
                { goalNotes },
              );
            }}
          />
        </div>
      )}

      {tab === 'body' && (
        <div className="card space-y-4">
          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-300">Базовые параметры</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Рост (см)</label>
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  placeholder="например 185"
                  value={bodyForm.heightCm}
                  onChange={(e) =>
                    setBodyForm({ ...bodyForm, heightCm: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">
                  Цель по весу (кг)
                </label>
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  placeholder="целевой вес"
                  value={bodyForm.targetWeightKg}
                  onChange={(e) =>
                    setBodyForm({ ...bodyForm, targetWeightKg: e.target.value })
                  }
                />
              </div>
            </div>
            {latestWeightKg != null && (
              <p className="mt-2 text-sm text-slate-400">
                Текущий вес:{' '}
                <span className="font-medium text-white">{latestWeightKg} кг</span>
                <span className="text-slate-500"> — из последней записи истории</span>
              </p>
            )}
            <button
              type="button"
              onClick={saveBodyBaseline}
              className="btn-secondary mt-3 w-full"
            >
              Сохранить рост и цель
            </button>
          </div>

          <div className="border-t border-slate-800 pt-3">
            <h3 className="mb-1 text-sm font-medium text-slate-300">
              Новая запись замеров
            </h3>
            <p className="mb-2 text-xs text-slate-500">
              Вес и обхваты попадают в историю — их можно править или удалить ниже
            </p>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Вес (кг)</label>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                placeholder="текущий вес"
                value={bodyForm.weightKg}
                onChange={(e) =>
                  setBodyForm({ ...bodyForm, weightKg: e.target.value })
                }
              />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(
                [
                  ['chestCm', 'Грудь (см)'],
                  ['waistCm', 'Талия (см)'],
                  ['hipsCm', 'Бёдра (см)'],
                  ['bicepsCm', 'Бицепс (см)'],
                  ['thighCm', 'Бедро (см)'],
                  ['bodyFatPct', '% жира'],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <label className="mb-1 block text-xs text-slate-500">{label}</label>
                  <input
                    className="input"
                    type="number"
                    inputMode="decimal"
                    value={bodyForm[key]}
                    onChange={(e) =>
                      setBodyForm({ ...bodyForm, [key]: e.target.value })
                    }
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={saveBodyLog}
              className="btn-primary mt-3 w-full"
            >
              Добавить в историю
            </button>
          </div>

          {body && body.logs.length > 0 && (
            <div className="border-t border-slate-800 pt-3">
              <h3 className="mb-2 font-medium">История</h3>
              <ul className="space-y-2 text-sm">
                {body.logs.slice(0, 20).map((l) => (
                  <li
                    key={l.id}
                    className="rounded-lg bg-slate-800/50 px-3 py-2"
                  >
                    {editingLogId === l.id ? (
                      <div className="space-y-2">
                        <p className="text-slate-400">
                          {new Date(l.recordedAt).toLocaleDateString('ru-RU')}
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {(
                            [
                              ['weightKg', 'Вес'],
                              ['chestCm', 'Грудь'],
                              ['waistCm', 'Талия'],
                              ['hipsCm', 'Бёдра'],
                              ['bicepsCm', 'Бицепс'],
                              ['thighCm', 'Бедро'],
                              ['bodyFatPct', '% жира'],
                            ] as const
                          ).map(([key, label]) => (
                            <div key={key}>
                              <label className="mb-0.5 block text-xs text-slate-500">
                                {label}
                              </label>
                              <input
                                className="input"
                                type="number"
                                inputMode="decimal"
                                value={editLogForm[key]}
                                onChange={(e) =>
                                  setEditLogForm({
                                    ...editLogForm,
                                    [key]: e.target.value,
                                  })
                                }
                              />
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={saveEditLog}
                            className="btn-primary flex-1"
                          >
                            Сохранить
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingLogId(null)}
                            className="btn-secondary flex-1"
                          >
                            Отмена
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-slate-400">
                            {new Date(l.recordedAt).toLocaleDateString('ru-RU')}
                          </p>
                          <p className="truncate">
                            {[
                              l.weightKg != null ? `${l.weightKg} кг` : null,
                              l.chestCm != null ? `Г ${l.chestCm}` : null,
                              l.waistCm != null ? `Т ${l.waistCm}` : null,
                              l.hipsCm != null ? `Бд ${l.hipsCm}` : null,
                              l.bicepsCm != null ? `Би ${l.bicepsCm}` : null,
                              l.thighCm != null ? `Бе ${l.thighCm}` : null,
                              l.bodyFatPct != null ? `${l.bodyFatPct}%` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ') || '—'}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() => startEditLog(l)}
                            className="text-xs text-fitgo-400"
                          >
                            Изменить
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteLog(l.id)}
                            className="text-xs text-red-400"
                          >
                            Удалить
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === 'training' && (
        <div className="card space-y-4">
          <div>
            <label className="mb-2 block text-sm text-slate-400">Опыт</label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(EXPERIENCE_LEVEL_LABELS) as ExperienceLevel[]).map(
                (lvl) => (
                  <Chip
                    key={lvl}
                    label={EXPERIENCE_LEVEL_LABELS[lvl]}
                    active={training.experienceLevel === lvl}
                    onClick={() => {
                      const experienceLevel =
                        training.experienceLevel === lvl ? null : lvl;
                      const next = { ...training, experienceLevel };
                      void saveTraining(next, {
                        experienceLevel: experienceLevel,
                      });
                    }}
                  />
                ),
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Лет тренировок</label>
              <input
                className="input"
                type="number"
                min={0}
                step={0.5}
                value={training.yearsTraining ?? ''}
                onChange={(e) =>
                  setTraining({
                    ...training,
                    yearsTraining: e.target.value ? Number(e.target.value) : null,
                  })
                }
                onBlur={(e) => {
                  const yearsTraining = e.target.value
                    ? Number(e.target.value)
                    : null;
                  void saveTraining(
                    { ...training, yearsTraining },
                    { yearsTraining },
                  );
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Раз в неделю</label>
              <input
                className="input"
                type="number"
                min={0}
                max={14}
                value={training.sessionsPerWeek ?? ''}
                onChange={(e) =>
                  setTraining({
                    ...training,
                    sessionsPerWeek: e.target.value ? Number(e.target.value) : null,
                  })
                }
                onBlur={(e) => {
                  const sessionsPerWeek = e.target.value
                    ? Number(e.target.value)
                    : null;
                  void saveTraining(
                    { ...training, sessionsPerWeek },
                    { sessionsPerWeek },
                  );
                }}
              />
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm text-slate-400">Любимые форматы</label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PREFERRED_MODALITY_LABELS) as PreferredModality[]).map(
                (m) => (
                  <Chip
                    key={m}
                    label={PREFERRED_MODALITY_LABELS[m]}
                    active={training.preferredModalities.includes(m)}
                    onClick={() => {
                      const preferredModalities = toggleInList(
                        training.preferredModalities,
                        m,
                      );
                      const next = { ...training, preferredModalities };
                      void saveTraining(next, { preferredModalities });
                    }}
                  />
                ),
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'limits' && (
        <div className="card space-y-4">
          <p className="text-sm text-slate-400">
            Сообщите тренеру зоны, с которыми нужно быть осторожнее. Это не
            медкарта — при сомнениях проконсультируйтесь с врачом. Выбор
            сохраняется сразу.
          </p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(BODY_LIMITATION_LABELS) as BodyLimitationZone[]).map(
              (z) => (
                <Chip
                  key={z}
                  label={BODY_LIMITATION_LABELS[z]}
                  active={training.limitations.includes(z)}
                  onClick={() => {
                    const limitations = toggleInList(
                      training.limitations,
                      z,
                      'NONE',
                    );
                    const next = { ...training, limitations };
                    void saveTraining(next, { limitations });
                  }}
                />
              ),
            )}
          </div>
          <textarea
            className="input min-h-[80px]"
            placeholder="Подробности (травмы, рекомендации врача…)"
            value={training.limitationNotes ?? ''}
            onChange={(e) =>
              setTraining({ ...training, limitationNotes: e.target.value })
            }
            onBlur={(e) => {
              const limitationNotes = e.target.value;
              void saveTraining(
                { ...training, limitationNotes },
                { limitationNotes },
              );
            }}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!training.pregnancyFlag}
              onChange={(e) => {
                const pregnancyFlag = e.target.checked;
                const next = { ...training, pregnancyFlag };
                void saveTraining(next, { pregnancyFlag });
              }}
            />
            Беременность / послеродовый период
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!training.bloodPressureFlag}
              onChange={(e) => {
                const bloodPressureFlag = e.target.checked;
                const next = { ...training, bloodPressureFlag };
                void saveTraining(next, { bloodPressureFlag });
              }}
            />
            Особенности давления / сердца (сообщите тренеру)
          </label>
        </div>
      )}

      {tab === 'prefs' && (
        <div className="card space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-400">
              Длительность сессии (мин)
            </label>
            <input
              className="input"
              type="number"
              min={15}
              max={180}
              step={5}
              value={training.preferredSessionMin ?? ''}
              onChange={(e) =>
                setTraining({
                  ...training,
                  preferredSessionMin: e.target.value
                    ? Number(e.target.value)
                    : null,
                })
              }
              onBlur={(e) => {
                const preferredSessionMin = e.target.value
                  ? Number(e.target.value)
                  : null;
                void saveTraining(
                  { ...training, preferredSessionMin },
                  { preferredSessionMin },
                );
              }}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm text-slate-400">Время суток</label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PREFERRED_TIME_LABELS) as PreferredTimeOfDay[]).map(
                (t) => (
                  <Chip
                    key={t}
                    label={PREFERRED_TIME_LABELS[t]}
                    active={training.preferredTimeOfDay === t}
                    onClick={() => {
                      const preferredTimeOfDay =
                        training.preferredTimeOfDay === t ? null : t;
                      const next = { ...training, preferredTimeOfDay };
                      void saveTraining(next, {
                        preferredTimeOfDay: preferredTimeOfDay,
                      });
                    }}
                  />
                ),
              )}
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm text-slate-400">Интенсивность</label>
            <div className="flex flex-wrap gap-2">
              {(
                Object.keys(PREFERRED_INTENSITY_LABELS) as PreferredIntensity[]
              ).map((i) => (
                <Chip
                  key={i}
                  label={PREFERRED_INTENSITY_LABELS[i]}
                  active={training.preferredIntensity === i}
                  onClick={() => {
                    const preferredIntensity =
                      training.preferredIntensity === i ? null : i;
                    const next = { ...training, preferredIntensity };
                    void saveTraining(next, {
                      preferredIntensity: preferredIntensity,
                    });
                  }}
                />
              ))}
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm text-slate-400">
              Инвентарь дома
            </label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(HOME_EQUIPMENT_LABELS) as HomeEquipmentItem[]).map(
                (eq) => (
                  <Chip
                    key={eq}
                    label={HOME_EQUIPMENT_LABELS[eq]}
                    active={training.homeEquipment.includes(eq)}
                    onClick={() => {
                      const homeEquipment = toggleInList(
                        training.homeEquipment,
                        eq,
                      );
                      const next = { ...training, homeEquipment };
                      void saveTraining(next, { homeEquipment });
                    }}
                  />
                ),
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'rating' && (
        <div className="card space-y-4">
          {profile.gamificationStartedAt ? (
            <p className="text-sm text-fitgo-400">
              Геймификация активна с{' '}
              {new Date(profile.gamificationStartedAt).toLocaleDateString('ru-RU')}
            </p>
          ) : (
            <p className="text-sm text-slate-400">
              Активируйте геймификацию, чтобы участвовать в лигах и получать бейджи.
            </p>
          )}

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={useRealName}
              onChange={(e) => setUseRealName(e.target.checked)}
            />
            <span className="text-sm">Показывать реальное имя в лигах</span>
          </label>

          {!useRealName && (
            <div className="flex gap-2">
              <input
                className="input flex-1"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Игровой ник"
              />
              <button type="button" onClick={suggestNick} className="btn-secondary">
                Другое имя
              </button>
            </div>
          )}

          <button type="button" onClick={activate} className="btn-primary w-full">
            {profile.gamificationStartedAt
              ? 'Сохранить настройки'
              : 'Активировать геймификацию'}
          </button>

          <Link href="/client/engagement" className="btn-secondary block text-center">
            Перейти к достижениям
          </Link>
        </div>
      )}
    </div>
  );
}
