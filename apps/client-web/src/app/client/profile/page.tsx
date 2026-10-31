'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  BODY_LIMITATION_LABELS,
  CLIENT_PRIMARY_GOAL_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  GOAL_HORIZON_OPTIONS,
  HOME_EQUIPMENT_LABELS,
  MembershipStatus,
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
  type Membership,
  type PreferredIntensity,
  type PreferredModality,
  type PreferredTimeOfDay,
} from '@fitgo/shared-types';
import {
  ChevronRight,
  Gift,
  LogOut,
  ShoppingBag,
  Trophy,
  Dumbbell,
  User,
  Target,
  Ruler,
  Activity,
  Ban,
  SlidersHorizontal,
  Star,
} from 'lucide-react';
import { Avatar } from '@/components/forma/avatar';
import { Button } from '@/components/forma/button';
import { Chip } from '@/components/forma/chip';
import { PageHeader } from '@/components/forma/page-header';
import { ProgressRing } from '@/components/forma/progress-ring';
import { Sheet } from '@/components/forma/sheet';
import { SkeletonCard } from '@/components/forma/skeleton';
import { PushSubscribeButton } from '@/components/push-subscribe-button';
import { DateField } from '@/components/ui/date-field';
import { api } from '@/lib/api';
import { clearAuth, getToken } from '@/lib/auth';

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

function ProfileChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Chip active={active} onClick={onClick}>
      {label}
    </Chip>
  );
}

const SHEET_META: {
  id: Tab;
  label: string;
  hint: string;
  icon: typeof User;
}[] = [
  { id: 'account', label: 'Данные', hint: 'Имя, телефон, дата рождения', icon: User },
  { id: 'goals', label: 'Цели', hint: '1–2 главные цели', icon: Target },
  { id: 'body', label: 'Тело', hint: 'Рост, вес, замеры', icon: Ruler },
  { id: 'training', label: 'Опыт', hint: 'Уровень и стаж', icon: Activity },
  { id: 'limits', label: 'Ограничения', hint: 'Зоны и противопоказания', icon: Ban },
  { id: 'prefs', label: 'Предпочтения', hint: 'Время, интенсивность', icon: SlidersHorizontal },
  { id: 'rating', label: 'Рейтинг', hint: 'Ник и лиги', icon: Star },
];

function membershipStatusLabel(m: Membership | null): string {
  if (!m) return 'Нет абонемента';
  if (typeof m.debtAmount === 'number' && m.debtAmount > 0) {
    return 'Долг по абонементу';
  }
  switch (m.status) {
    case MembershipStatus.ACTIVE:
      return 'Абонемент активен';
    case MembershipStatus.FROZEN:
      return 'Заморожен';
    case MembershipStatus.EXPIRED:
      return 'Истёк';
    case MembershipStatus.PENDING:
      return 'Ожидает оформления';
    default:
      return String(m.status);
  }
}

export default function ClientProfilePage() {
  const router = useRouter();
  const [sheet, setSheet] = useState<Tab | null>(null);
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
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
  const [deleteLogId, setDeleteLogId] = useState<string | null>(null);
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
    if (!token) return;
    api
      .clientDashboard(token)
      .then((d) => setMembership(d.membership))
      .catch(() => {});
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
        heightCm: bodyForm.heightCm ? Number(bodyForm.heightCm) : undefined,
        targetWeightKg: bodyForm.targetWeightKg
          ? Number(bodyForm.targetWeightKg)
          : undefined,
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
    setError('');
    try {
      await api.deleteBodyLog(token, id);
      if (editingLogId === id) setEditingLogId(null);
      setDeleteLogId(null);
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
      <div className="space-y-3">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const displayName =
    `${profile.firstName} ${profile.lastName}`.trim() || 'Клиент';

  const logout = () => {
    clearAuth();
    router.push('/login');
  };

  const openSheet = (id: Tab) => {
    setSheet(id);
    setMsg('');
    setError('');
    setEditingLogId(null);
  };

  const sheetMeta = SHEET_META.find((s) => s.id === sheet);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Профиль"
        subtitle="Анкета для тренировок — видна вам и тренеру"
      />

      <div className="card flex items-center gap-4">
        <Avatar name={displayName} size="xl" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-xl font-bold text-white">
            {displayName}
          </p>
          {profile.phone ? (
            <p className="text-sm text-zinc-400">{profile.phone}</p>
          ) : null}
          <p
            className={`mt-1 text-xs font-medium ${
              typeof membership?.debtAmount === 'number' &&
              membership.debtAmount > 0
                ? 'text-rose-400'
                : membership?.status === MembershipStatus.ACTIVE
                  ? 'text-emerald-400'
                  : membership?.status === MembershipStatus.FROZEN
                    ? 'text-amber-400'
                    : 'text-zinc-500'
            }`}
          >
            {membershipStatusLabel(membership)}
          </p>
        </div>
        <ProgressRing value={completeness} max={100} size={64} stroke={6}>
          <span className="font-display text-xs font-bold tabular-nums text-forma-400">
            {completeness}%
          </span>
        </ProgressRing>
      </div>

      <div>
        <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Анкета
        </p>
        <div className="overflow-hidden rounded-3xl border border-white/[0.08] bg-ink-elevated/90">
          {SHEET_META.map((item, i, arr) => (
            <button
              key={item.id}
              type="button"
              onClick={() => openSheet(item.id)}
              className={`flex w-full items-center gap-3 px-4 py-3.5 text-left touch-manipulation hover:bg-white/[0.03] ${
                i < arr.length - 1 ? 'border-b border-white/[0.06]' : ''
              }`}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-forma-400">
                <item.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-white">{item.label}</span>
                <span className="block text-xs text-zinc-500">{item.hint}</span>
              </span>
              <ChevronRight className="h-4 w-4 text-zinc-500" />
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Клуб
        </p>
        <div className="overflow-hidden rounded-3xl border border-white/[0.08] bg-ink-elevated/90">
          {(
            [
              {
                href: '/client/visits',
                label: 'Визиты',
                icon: Dumbbell,
              },
              {
                href: '/client/engagement',
                label: 'Достижения',
                icon: Trophy,
              },
              {
                href: '/client/products',
                label: 'Абонементы',
                icon: ShoppingBag,
              },
              {
                href: '/client/referral',
                label: 'Пригласить друга',
                icon: Gift,
              },
            ] as const
          ).map((item, i, arr) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3.5 touch-manipulation hover:bg-white/[0.03] ${
                i < arr.length - 1 ? 'border-b border-white/[0.06]' : ''
              }`}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-forma-500/15 text-forma-400">
                <item.icon className="h-4 w-4" />
              </span>
              <span className="flex-1 font-medium text-white">{item.label}</span>
              <ChevronRight className="h-4 w-4 text-zinc-500" />
            </Link>
          ))}
        </div>
      </div>

      <div className="card flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-white">Уведомления</p>
          <p className="text-xs text-zinc-500">Push о записях и новостях клуба</p>
        </div>
        <PushSubscribeButton />
      </div>

      {savingTraining && (
        <p className="text-xs text-zinc-500">Сохранение анкеты…</p>
      )}
      {msg && <p className="text-sm text-forma-400">{msg}</p>}
      {error && <p className="text-sm text-rose-400">{error}</p>}

      <Sheet
        open={sheet != null}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
        title={sheetMeta?.label}
        description={sheetMeta?.hint}
      >
        {sheet === 'account' && (
        <div className="space-y-3">
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
          <DateField
            label="Дата рождения"
            value={profile.dateOfBirth ?? ''}
            onChange={(v) => setProfile({ ...profile, dateOfBirth: v })}
          />
          <button type="button" onClick={saveProfile} className="btn-primary bg-forma-500 text-ink hover:bg-forma-400 w-full">
            Сохранить
          </button>
        </div>
      )}

      {sheet === 'goals' && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            Выберите 1–2 главные цели — сохраняется сразу
          </p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CLIENT_PRIMARY_GOAL_LABELS) as ClientPrimaryGoal[]).map(
              (g) => (
                <ProfileChip
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
            <label className="mb-1 block text-sm text-zinc-400">Горизонт</label>
            <div className="flex flex-wrap gap-2">
              {GOAL_HORIZON_OPTIONS.map((w) => (
                <ProfileChip
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

      {sheet === 'body' && (
        <div className="space-y-4">
          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-300">Базовые параметры</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Рост (см)</label>
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
                <label className="mb-1 block text-xs text-zinc-500">
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
              <p className="mt-2 text-sm text-zinc-400">
                Текущий вес:{' '}
                <span className="font-medium text-white">{latestWeightKg} кг</span>
                <span className="text-zinc-500"> — из последней записи истории</span>
              </p>
            )}
            <button
              type="button"
              onClick={saveBodyBaseline}
              className="btn-secondary border-white/10 bg-ink-raised text-white hover:bg-ink-elevated mt-3 w-full"
            >
              Сохранить рост и цель
            </button>
          </div>

          <div className="border-t border-slate-800 pt-3">
            <h3 className="mb-1 text-sm font-medium text-zinc-300">
              Новая запись замеров
            </h3>
            <p className="mb-2 text-xs text-zinc-500">
              Вес и обхваты попадают в историю — их можно править или удалить ниже
            </p>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Вес (кг)</label>
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
                  <label className="mb-1 block text-xs text-zinc-500">{label}</label>
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
              className="btn-primary bg-forma-500 text-ink hover:bg-forma-400 mt-3 w-full"
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
                    className="rounded-lg bg-ink-raised/50 px-3 py-2"
                  >
                    {editingLogId === l.id ? (
                      <div className="space-y-2">
                        <p className="text-zinc-400">
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
                              <label className="mb-0.5 block text-xs text-zinc-500">
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
                            className="btn-primary bg-forma-500 text-ink hover:bg-forma-400 flex-1"
                          >
                            Сохранить
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingLogId(null)}
                            className="btn-secondary border-white/10 bg-ink-raised text-white hover:bg-ink-elevated flex-1"
                          >
                            Отмена
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-zinc-400">
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
                            className="text-xs text-forma-400"
                          >
                            Изменить
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteLogId(l.id)}
                            className="text-xs text-rose-400"
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

      {sheet === 'training' && (
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-zinc-400">Опыт</label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(EXPERIENCE_LEVEL_LABELS) as ExperienceLevel[]).map(
                (lvl) => (
                  <ProfileChip
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
              <label className="mb-1 block text-sm text-zinc-400">Лет тренировок</label>
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
              <label className="mb-1 block text-sm text-zinc-400">Раз в неделю</label>
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
            <label className="mb-2 block text-sm text-zinc-400">Любимые форматы</label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PREFERRED_MODALITY_LABELS) as PreferredModality[]).map(
                (m) => (
                  <ProfileChip
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

      {sheet === 'limits' && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            Сообщите тренеру зоны, с которыми нужно быть осторожнее. Это не
            медкарта — при сомнениях проконсультируйтесь с врачом. Выбор
            сохраняется сразу.
          </p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(BODY_LIMITATION_LABELS) as BodyLimitationZone[]).map(
              (z) => (
                <ProfileChip
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

      {sheet === 'prefs' && (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-zinc-400">
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
            <label className="mb-2 block text-sm text-zinc-400">Время суток</label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PREFERRED_TIME_LABELS) as PreferredTimeOfDay[]).map(
                (t) => (
                  <ProfileChip
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
            <label className="mb-2 block text-sm text-zinc-400">Интенсивность</label>
            <div className="flex flex-wrap gap-2">
              {(
                Object.keys(PREFERRED_INTENSITY_LABELS) as PreferredIntensity[]
              ).map((i) => (
                <ProfileChip
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
            <label className="mb-2 block text-sm text-zinc-400">
              Инвентарь дома
            </label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(HOME_EQUIPMENT_LABELS) as HomeEquipmentItem[]).map(
                (eq) => (
                  <ProfileChip
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

      {sheet === 'rating' && (
        <div className="space-y-4">
          {profile.gamificationStartedAt ? (
            <p className="text-sm text-forma-400">
              Геймификация активна с{' '}
              {new Date(profile.gamificationStartedAt).toLocaleDateString('ru-RU')}
            </p>
          ) : (
            <p className="text-sm text-zinc-400">
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
              <button type="button" onClick={suggestNick} className="btn-secondary border-white/10 bg-ink-raised text-white hover:bg-ink-elevated">
                Другое имя
              </button>
            </div>
          )}

          <button type="button" onClick={activate} className="btn-primary bg-forma-500 text-ink hover:bg-forma-400 w-full">
            {profile.gamificationStartedAt
              ? 'Сохранить настройки'
              : 'Активировать геймификацию'}
          </button>

          <Link href="/client/engagement" className="btn-secondary border-white/10 bg-ink-raised text-white hover:bg-ink-elevated block text-center">
            Перейти к достижениям
          </Link>
        </div>
      )}
      </Sheet>

      <button
        type="button"
        onClick={logout}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3.5 text-sm font-medium text-rose-300 touch-manipulation hover:bg-rose-500/15"
      >
        <LogOut className="h-4 w-4" />
        Выйти
      </button>

      <Sheet
        open={deleteLogId != null}
        onOpenChange={(open) => {
          if (!open) setDeleteLogId(null);
        }}
        title="Удалить замеры?"
        description="Запись нельзя будет восстановить."
      >
        <div className="flex gap-2 pt-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => setDeleteLogId(null)}
          >
            Отмена
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            onClick={() => {
              if (deleteLogId) void deleteLog(deleteLogId);
            }}
          >
            Удалить
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
