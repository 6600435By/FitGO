'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type StaffProfileDto } from '@/lib/api';
import { getToken } from '@/lib/auth';

export function StaffProfilePage({ title }: { title: string }) {
  const [profile, setProfile] = useState<StaffProfileDto | null>(null);
  const [bio, setBio] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setError(null);
    try {
      const p = await api.staffProfileMine(token);
      setProfile(p);
      setBio(p.bio ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить профиль');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveBio() {
    const token = getToken();
    if (!token) return;
    setSaving(true);
    setOk(null);
    setError(null);
    try {
      const p = await api.staffProfileUpdateBio(token, bio);
      setProfile(p);
      setBio(p.bio);
      setOk('Описание сохранено');
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
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/me/staff-profile/photo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message || res.statusText,
        );
      }
      const p = (await res.json()) as StaffProfileDto;
      setProfile(p);
      setOk('Фото обновлено');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки фото');
    } finally {
      setSaving(false);
    }
  }

  if (!profile && !error) {
    return <p className="text-slate-400 text-sm">Загрузка…</p>;
  }

  const roleLabel = [
    profile?.groupPrograms ? 'Тренер ГП' : null,
    profile?.trainerStaff ? 'Тренер ПТ (штат)' : null,
    profile?.trainerClub ? 'Тренер ПТ (клуб)' : null,
    profile?.roles?.includes('SPECIALIST') ? 'SPA-специалист' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
        <p className="text-sm text-slate-400 mt-1">
          ФИО и роль из 1С. Описание и фото видят клиенты.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-400 bg-red-950/40 rounded-xl px-3 py-2">
          {error}
        </p>
      )}
      {ok && (
        <p className="text-sm text-fitgo-400 bg-fitgo-900/30 rounded-xl px-3 py-2">
          {ok}
        </p>
      )}
      {profile?.hiddenByAdmin && (
        <p className="text-sm text-amber-300">
          Админ скрыл ваше описание и фото от клиентов.
        </p>
      )}

      <section className="card space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Данные из 1С</h2>
        <dl className="grid gap-2 text-sm">
          <div>
            <dt className="text-slate-500">ФИО</dt>
            <dd className="text-slate-100">
              {profile?.lastName} {profile?.firstName}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Роль</dt>
            <dd className="text-slate-100">{roleLabel || '—'}</dd>
          </div>
          {profile?.phone && (
            <div>
              <dt className="text-slate-500">Телефон</dt>
              <dd className="text-slate-100">{profile.phone}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="card space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Фото</h2>
        <div className="flex items-center gap-4">
          {profile?.photoThumbUrl || profile?.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.photoThumbUrl || profile.photoUrl || ''}
              alt=""
              className="h-20 w-20 rounded-2xl object-cover border border-slate-700"
            />
          ) : (
            <div className="h-20 w-20 rounded-2xl bg-slate-800 border border-slate-700" />
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
      </section>

      <section className="card space-y-3">
        <div className="flex justify-between items-baseline">
          <h2 className="text-sm font-medium text-slate-300">Описание</h2>
          <span className="text-xs text-slate-500">
            {bio.length}/{profile?.bioMax ?? 1000}
          </span>
        </div>
        <textarea
          className="input min-h-[140px] w-full"
          value={bio}
          maxLength={profile?.bioMax ?? 1000}
          onChange={(e) => setBio(e.target.value)}
          placeholder="О себе для клиентов…"
        />
        <button
          type="button"
          className="btn-primary"
          disabled={saving}
          onClick={() => void saveBio()}
        >
          Сохранить
        </button>
      </section>

      <section className="card space-y-2">
        <h2 className="text-sm font-medium text-slate-300">
          Как увидит клиент
        </h2>
        <div className="flex gap-3 items-start">
          {profile?.photoThumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.photoThumbUrl}
              alt=""
              className="h-14 w-14 rounded-xl object-cover"
            />
          ) : (
            <div className="h-14 w-14 rounded-xl bg-slate-800" />
          )}
          <div>
            <p className="font-medium text-slate-100">
              {profile?.lastName} {profile?.firstName}
            </p>
            <p className="text-sm text-slate-400 whitespace-pre-wrap mt-1">
              {bio.trim() || '—'}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
