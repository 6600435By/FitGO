'use client';

import {
  Avatar,
  BentoCard,
  Button,
  Chip,
  ListGroup,
  ListRow,
  PageHeader,
  SegmentedControl,
  Skeleton,
} from '@fitgo/forma-ui';
import { Bell, LogOut, Volume2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MotivationCard } from '@/components/trainer-motivation/motivation-card';
import {
  PersonalGoalsCard,
  PersonalGoalsEditor,
  usePersonalGoals,
} from '@/components/trainer-motivation/personal-goals-card';
import { api, type StaffProfileDto } from '@/lib/api';
import { clearAuth, getToken, getUser } from '@/lib/auth';
import {
  buildMotivationRecords,
  loadJournalWeekStreak,
} from '@/lib/trainer-motivation';
import { trainerCabinetMode } from '@/lib/trainer-cabinet';
import {
  loadTrainerTimerPrefs,
  saveTrainerTimerPrefs,
  type TrainerTimerPrefs,
} from '@/lib/trainer-timer-prefs';
import type { SoundPackId } from '@/lib/training-timer/types';
import { requestAndSubscribePush, pushSupported } from '@/lib/push';

const SPECIALIZATIONS = [
  'Силовые',
  'Функциональный тренинг',
  'Похудение',
  'Реабилитация',
  'Stretching',
  'Йога',
  'Пилатес',
  'Реформеры',
  'Кроссфит',
  'Бокс',
  'Детский фитнес',
];

const SOUND_PACKS: Array<{ id: SoundPackId; label: string }> = [
  { id: 'classic', label: 'Классика' },
  { id: 'gong', label: 'Гонг' },
  { id: 'whistle', label: 'Свисток' },
];

export function TrainerProfileForma() {
  const router = useRouter();
  const user = getUser();
  const cabinet = trainerCabinetMode(user);
  const isPureClub =
    Boolean(user?.trainerClub) && !user?.trainerStaff && !cabinet.showGp;
  const personalGoals = usePersonalGoals(isPureClub);
  const [profile, setProfile] = useState<StaffProfileDto | null>(null);
  const [bio, setBio] = useState('');
  const [specs, setSpecs] = useState<string[]>([]);
  const [years, setYears] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [motivation, setMotivation] = useState(
    buildMotivationRecords(null, loadJournalWeekStreak()),
  );
  const [timerPrefs, setTimerPrefs] = useState<TrainerTimerPrefs>(() =>
    loadTrainerTimerPrefs(),
  );
  const [pushStatus, setPushStatus] = useState<string>('');
  const [acceptsBookings, setAcceptsBookings] = useState(false);
  const [acceptsBusy, setAcceptsBusy] = useState(false);

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setError(null);
    try {
      const [p, home] = await Promise.all([
        api.staffProfileMine(token),
        api.trainerGpHome(token).catch(() => null),
      ]);
      setProfile(p);
      setBio(p.bio ?? '');
      setSpecs(p.specializations ?? []);
      setAcceptsBookings(Boolean(p.acceptsClientBookings));
      setYears(
        typeof p.experienceYears === 'number' ? String(p.experienceYears) : '',
      );
      setMotivation(
        buildMotivationRecords(
          home?.monthAnalytics ?? null,
          loadJournalWeekStreak(),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить профиль');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const roleLabel = useMemo(
    () =>
      [
        profile?.groupPrograms ? 'Тренер ГП' : null,
        profile?.trainerStaff ? 'Тренер ПТ (штат)' : null,
        profile?.trainerClub ? 'Тренер ПТ (клуб)' : null,
        profile?.trainerReformers ? 'Реформеры' : null,
      ]
        .filter(Boolean)
        .join(' · '),
    [profile],
  );

  async function saveProfile() {
    const token = getToken();
    if (!token) return;
    setSaving(true);
    setOk(null);
    setError(null);
    try {
      const yearsNum = years.trim() ? Number(years) : null;
      const p = await api.staffProfileUpdate(token, {
        bio,
        specializations: specs,
        experienceYears:
          yearsNum != null && Number.isFinite(yearsNum) ? yearsNum : null,
      });
      setProfile(p);
      setBio(p.bio);
      setSpecs(p.specializations ?? []);
      setOk('Сохранено');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }

  async function onPhoto(file: File | null) {
    const token = getToken();
    if (!token || !file) return;
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const p = await api.staffProfileUploadPhoto(token, file);
      setProfile(p);
      setOk('Фото обновлено');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки фото');
    } finally {
      setSaving(false);
    }
  }

  function updateTimerPrefs(patch: Partial<TrainerTimerPrefs>) {
    const next = { ...timerPrefs, ...patch };
    setTimerPrefs(next);
    saveTrainerTimerPrefs(next);
  }

  async function enablePush() {
    setPushStatus('…');
    const result = await requestAndSubscribePush();
    setPushStatus(
      result === 'subscribed'
        ? 'Включены'
        : result === 'denied'
          ? 'Запрещены в браузере'
          : 'Недоступны',
    );
  }

  function logout() {
    clearAuth();
    router.replace('/login');
  }

  if (!profile && !error) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48 w-full rounded-3xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-8">
      <PageHeader
        title="Профиль"
        subtitle="Как тебя видит клиент · настройки Forma Coach"
      />

      {error ? (
        <p className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {ok}
        </p>
      ) : null}

      <BentoCard title="Как увидит клиент">
        <div className="flex gap-4">
          {profile?.photoThumbUrl || profile?.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.photoThumbUrl || profile.photoUrl || ''}
              alt=""
              className="h-14 w-14 shrink-0 rounded-2xl object-cover"
            />
          ) : (
            <Avatar
              name={`${profile?.firstName ?? ''} ${profile?.lastName ?? ''}`}
              size="lg"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-semibold text-white">
              {profile?.lastName} {profile?.firstName}
            </p>
            <p className="text-xs text-zinc-500">{roleLabel || '—'}</p>
            {specs.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {specs.map((s) => (
                  <Chip key={s} active>
                    {s}
                  </Chip>
                ))}
              </div>
            ) : null}
            <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-400">
              {bio.trim() || 'Добавь описание — клиенты видят его в приложении.'}
            </p>
          </div>
        </div>
        <label className="mt-4 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={acceptsBookings}
            disabled={acceptsBusy}
            onChange={(e) => {
              const next = e.target.checked;
              setAcceptsBookings(next);
              const token = getToken();
              if (!token) return;
              setAcceptsBusy(true);
              void api
                .staffProfileUpdate(token, { acceptsClientBookings: next })
                .then((p) => {
                  setProfile(p);
                  setOk(
                    next
                      ? 'Клиенты могут записываться к вам'
                      : 'Запись клиентами выключена',
                  );
                })
                .catch((err: Error) => {
                  setAcceptsBookings(!next);
                  setError(err.message || 'Не удалось сохранить');
                })
                .finally(() => setAcceptsBusy(false));
            }}
          />
          <span>
            <span className="block text-sm font-medium text-white">
              Клиенты могут записываться
            </span>
            <span className="mt-0.5 block text-xs text-zinc-500">
              Пока выключено — вас нет в списке записи клиента. Включайте, когда
              опубликовали окна в расписании.
            </span>
          </span>
        </label>
      </BentoCard>

      {isPureClub ? (
        <>
          <PersonalGoalsCard
            data={personalGoals.data}
            onEdit={() => personalGoals.setEditorOpen(true)}
          />
          <PersonalGoalsEditor
            open={personalGoals.editorOpen}
            onOpenChange={personalGoals.setEditorOpen}
            initial={personalGoals.initialInputs}
            onSaved={(d) => personalGoals.setData(d)}
          />
        </>
      ) : motivation ? (
        <MotivationCard records={motivation} />
      ) : null}

      <BentoCard title="Фото и описание">
        <div className="mb-3 flex items-center gap-3">
          {profile?.photoThumbUrl || profile?.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.photoThumbUrl || profile.photoUrl || ''}
              alt=""
              className="h-16 w-16 rounded-2xl object-cover"
            />
          ) : (
            <div className="h-16 w-16 rounded-2xl bg-ink-raised" />
          )}
          <label className="btn-secondary cursor-pointer text-sm">
            Загрузить
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => void onPhoto(e.target.files?.[0] ?? null)}
              disabled={saving}
            />
          </label>
        </div>
        <label className="block text-xs text-zinc-500">
          Описание
          <textarea
            className="input mt-1 min-h-[120px] w-full py-3"
            value={bio}
            maxLength={profile?.bioMax ?? 1000}
            onChange={(e) => setBio(e.target.value)}
            placeholder="О себе для клиентов…"
          />
        </label>
        <p className="mt-1 text-right text-[11px] text-zinc-600">
          {bio.length}/{profile?.bioMax ?? 1000}
        </p>
      </BentoCard>

      <BentoCard title="Специализации и опыт">
        <div className="flex flex-wrap gap-1.5">
          {SPECIALIZATIONS.map((s) => (
            <Chip
              key={s}
              active={specs.includes(s)}
              onClick={() =>
                setSpecs((prev) =>
                  prev.includes(s)
                    ? prev.filter((x) => x !== s)
                    : [...prev, s].slice(0, 8),
                )
              }
            >
              {s}
            </Chip>
          ))}
        </div>
        <label className="mt-3 block text-xs text-zinc-500">
          Опыт, лет
          <input
            className="input mt-1 max-w-[8rem]"
            inputMode="numeric"
            value={years}
            onChange={(e) => setYears(e.target.value.replace(/\D/g, '').slice(0, 2))}
            placeholder="—"
          />
        </label>
        <Button
          className="mt-3 w-full"
          disabled={saving}
          onClick={() => void saveProfile()}
        >
          Сохранить профиль
        </Button>
      </BentoCard>

      <BentoCard
        title="Уведомления"
        action={<Bell className="h-4 w-4 text-zinc-500" />}
      >
        {pushSupported() ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => void enablePush()}>
              Включить push
            </Button>
            {pushStatus ? (
              <span className="text-sm text-zinc-400">{pushStatus}</span>
            ) : (
              <span className="text-sm text-zinc-500">
                {typeof Notification !== 'undefined' &&
                Notification.permission === 'granted'
                  ? 'Разрешены'
                  : 'Нужно разрешение браузера'}
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Push в этом браузере недоступны.</p>
        )}
      </BentoCard>

      <BentoCard
        title="Звук таймера"
        action={<Volume2 className="h-4 w-4 text-zinc-500" />}
      >
        <p className="mb-2 text-xs text-zinc-500">Пакет сигналов</p>
        <SegmentedControl
          value={timerPrefs.soundPack}
          onChange={(id) =>
            updateTimerPrefs({ soundPack: id as SoundPackId })
          }
          options={SOUND_PACKS.map((p) => ({ value: p.id, label: p.label }))}
        />
        <ListGroup className="mt-3">
          <ListRow
            title="Звук"
            trailing={
              <input
                type="checkbox"
                className="h-5 w-5 accent-forma-500"
                checked={timerPrefs.soundEnabled}
                onChange={(e) =>
                  updateTimerPrefs({ soundEnabled: e.target.checked })
                }
              />
            }
          />
          <ListRow
            title="Голосовой отсчёт"
            trailing={
              <input
                type="checkbox"
                className="h-5 w-5 accent-forma-500"
                checked={timerPrefs.voiceEnabled}
                onChange={(e) =>
                  updateTimerPrefs({ voiceEnabled: e.target.checked })
                }
              />
            }
          />
          <ListRow
            title="Вибрация"
            trailing={
              <input
                type="checkbox"
                className="h-5 w-5 accent-forma-500"
                checked={timerPrefs.vibrateEnabled}
                onChange={(e) =>
                  updateTimerPrefs({ vibrateEnabled: e.target.checked })
                }
              />
            }
          />
        </ListGroup>
        <label className="mt-3 block text-xs text-zinc-500">
          Громкость {Math.round(timerPrefs.volume * 100)}%
          <input
            type="range"
            min={0}
            max={100}
            className="mt-2 w-full accent-forma-500"
            value={Math.round(timerPrefs.volume * 100)}
            onChange={(e) =>
              updateTimerPrefs({ volume: Number(e.target.value) / 100 })
            }
          />
        </label>
      </BentoCard>

      <button
        type="button"
        onClick={logout}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200 transition hover:bg-rose-500/20"
      >
        <LogOut className="h-4 w-4" />
        Выйти
        {user?.email ? (
          <span className="text-xs text-rose-200/60">· {user.email}</span>
        ) : null}
      </button>
    </div>
  );
}
