'use client';

import {
  AuthError,
  AuthShell,
  AuthStepBar,
  AuthSuccess,
  Button,
  Chip,
  FieldLabel,
} from '@fitgo/forma-ui';
import confetti from 'canvas-confetti';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { PushBridge } from '@/components/push-bridge';
import { WorkScheduleTemplateEditor } from '@/components/trainer-schedule/work-schedule-template-editor';
import { api, type StaffProfileDto } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { trainerCabinetMode } from '@/lib/trainer-cabinet';

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

export default function TrainerWelcomePage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [profile, setProfile] = useState<StaffProfileDto | null>(null);
  const [bio, setBio] = useState('');
  const [specs, setSpecs] = useState<string[]>([]);
  const [years, setYears] = useState('');
  const [certs, setCerts] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const showPt = useMemo(
    () => trainerCabinetMode(profile).showPt,
    [profile],
  );

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api
      .staffProfileMine(token)
      .then((p) => {
        setProfile(p);
        setBio(p.bio ?? '');
        setSpecs(p.specializations ?? []);
        setYears(
          typeof p.experienceYears === 'number'
            ? String(p.experienceYears)
            : '',
        );
        if (Array.isArray(p.certificates)) {
          setCerts(
            (p.certificates as { title?: string }[])
              .map((c) => c.title)
              .filter(Boolean)
              .join(', '),
          );
        }
        if (p.onboardedAt) {
          router.replace('/trainer');
        }
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : 'Не удалось загрузить профиль'),
      );
  }, [router]);

  const toggleSpec = (s: string) => {
    setSpecs((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s].slice(0, 8),
    );
  };

  const saveStep1 = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      const p = await api.staffProfileUpdate(token, { bio });
      setProfile(p);
      setOk('Сохранено');
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  };

  const onPhoto = async (file: File | null) => {
    const token = getToken();
    if (!token || !file) return;
    setBusy(true);
    setError('');
    try {
      const p = await api.staffProfileUploadPhoto(token, file);
      setProfile(p);
      setOk('Фото обновлено');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка фото');
    } finally {
      setBusy(false);
    }
  };

  const saveStep2 = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      const experienceYears =
        years.trim() === '' ? null : Number.parseInt(years, 10);
      if (
        experienceYears !== null &&
        (!Number.isFinite(experienceYears) || experienceYears < 0)
      ) {
        throw new Error('Укажите стаж числом');
      }
      const certificates = certs
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .map((title) => ({ title }));
      const p = await api.staffProfileUpdate(token, {
        specializations: specs,
        experienceYears,
        certificates,
      });
      setProfile(p);
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      await api.staffProfileUpdate(token, { onboardedAt: true });
      try {
        confetti({
          particleCount: 90,
          spread: 70,
          origin: { y: 0.65 },
          colors: ['#FFD000', '#ffffff', '#a1a1aa'],
        });
      } catch {
        /* ignore */
      }
      router.replace('/trainer');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось завершить');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="forma-theme min-h-dvh">
      <AuthShell
        brand="coach"
        homeHref="/trainer"
        title="Добро пожаловать"
        subtitle="Короткий мастер — и кабинет Forma Coach готов"
        wide
      >
        <AuthStepBar step={step} total={4} />
        <AuthError>{error}</AuthError>
        <AuthSuccess>{ok}</AuthSuccess>

        {step === 1 ? (
          <div className="space-y-4">
            <div>
              <FieldLabel>Фото</FieldLabel>
              <div className="flex items-center gap-3">
                {profile?.photoThumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.photoThumbUrl}
                    alt=""
                    className="h-16 w-16 rounded-2xl object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-ink-raised text-xs text-zinc-500">
                    нет
                  </div>
                )}
                <label className="btn-secondary cursor-pointer text-sm">
                  Загрузить
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => void onPhoto(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            </div>
            <div>
              <FieldLabel htmlFor="bio">О себе</FieldLabel>
              <textarea
                id="bio"
                className="input h-auto min-h-[7rem] py-3 leading-relaxed"
                value={bio}
                maxLength={profile?.bioMax ?? 1000}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Клиенты увидят это в твоей карточке"
              />
            </div>
            <Button
              className="w-full"
              loading={busy}
              onClick={() => void saveStep1()}
            >
              Дальше
            </Button>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <div>
              <FieldLabel>Специализации</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {SPECIALIZATIONS.map((s) => (
                  <Chip
                    key={s}
                    active={specs.includes(s)}
                    onClick={() => toggleSpec(s)}
                  >
                    {s}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <FieldLabel htmlFor="years">Стаж, лет</FieldLabel>
              <input
                id="years"
                className="input"
                inputMode="numeric"
                value={years}
                onChange={(e) => setYears(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="Например, 5"
              />
            </div>
            <div>
              <FieldLabel htmlFor="certs">Сертификаты</FieldLabel>
              <input
                id="certs"
                className="input"
                value={certs}
                onChange={(e) => setCerts(e.target.value)}
                placeholder="Через запятую"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setStep(1)}>
                Назад
              </Button>
              <Button
                className="flex-1"
                loading={busy}
                onClick={() => void saveStep2()}
              >
                Дальше
              </Button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-400">
              Включи уведомления — утренний дайджест и напоминания о записях.
            </p>
            <PushBridge prompt />
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setStep(2)}>
                Назад
              </Button>
              <Button className="flex-1" onClick={() => setStep(4)}>
                Дальше
              </Button>
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="space-y-4">
            {showPt ? (
              <>
                <p className="text-sm text-zinc-400">
                  Шаблон рабочей недели для ПТ — потом можно изменить в
                  расписании.
                </p>
                <div className="rounded-3xl border border-white/10 bg-ink-elevated/80 p-3">
                  <WorkScheduleTemplateEditor />
                </div>
              </>
            ) : null}
            <div className="rounded-3xl border border-forma-500/25 bg-forma-500/10 p-4 text-sm text-zinc-300">
              <p className="font-display font-semibold text-forma-400">
                Короткий тур
              </p>
              <p className="mt-2">
                Телефон: док из пяти вкладок, центр — быстрые действия. Планшет:
                рейл слева. ПК: боковое меню, ⌘K и клавиша N для записи на ПТ.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setStep(3)}
              >
                Назад
              </Button>
              <Button
                className="flex-1"
                loading={busy}
                onClick={() => void finish()}
              >
                В кабинет
              </Button>
            </div>
          </div>
        ) : null}
      </AuthShell>
    </div>
  );
}
