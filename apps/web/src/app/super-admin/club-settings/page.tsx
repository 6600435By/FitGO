'use client';

import type { ClubDayHours, ClubWorkingHours, DayOfWeekKey } from '@fitgo/shared-types';
import {
  DAY_OF_WEEK_KEYS,
  DEFAULT_CLUB_WORKING_HOURS,
} from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

const DAY_NAMES: Record<DayOfWeekKey, string> = {
  monday: 'Понедельник',
  tuesday: 'Вторник',
  wednesday: 'Среда',
  thursday: 'Четверг',
  friday: 'Пятница',
  saturday: 'Суббота',
  sunday: 'Воскресенье',
};

export default function SuperAdminClubSettingsPage() {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#14b88a');
  const [logoUrl, setLogoUrl] = useState('');
  const [hours, setHours] = useState<ClubWorkingHours>(DEFAULT_CLUB_WORKING_HOURS);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api
      .superAdminClubProfile(token)
      .then((profile) => {
        setName(profile.name);
        setAddress(profile.address ?? '');
        setPhone(profile.phone ?? '');
        setWebsite(profile.website ?? '');
        setPrimaryColor(profile.theme.primaryColor);
        setLogoUrl(profile.theme.logoUrl ?? '');
        if (profile.workingHours) {
          setHours({ ...DEFAULT_CLUB_WORKING_HOURS, ...profile.workingHours });
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'));
  }, []);

  const setDay = (key: DayOfWeekKey, patch: Partial<ClubDayHours>) => {
    setHours((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? { open: '08:00', close: '22:00' }), ...patch },
    }));
  };

  const handleSave = async () => {
    const token = getToken();
    if (!token) return;
    setError('');
    try {
      await api.superAdminUpdateClubProfile(token, {
        name: name.trim(),
        address: address.trim(),
        phone: phone.trim(),
        website: website.trim(),
        primaryColor,
        logoUrl: logoUrl || undefined,
        workingHours: hours,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-10">
      <header>
        <h1 className="text-2xl font-semibold text-white">Настройки клуба</h1>
        <p className="text-sm text-slate-400">
          Брендинг и часы работы. Часы ограничивают смены в графике и участвуют в
          расчёте ЗП по отработанным часам.
        </p>
      </header>

      <div className="card space-y-4">
        <h2 className="text-lg font-medium text-white">Профиль и брендинг</h2>
        <div>
          <label className="stat-label">Название клуба</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input mt-2 w-full"
          />
        </div>
        <div>
          <label className="stat-label">Адрес</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="input mt-2 w-full"
          />
        </div>
        <div>
          <label className="stat-label">Телефон</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="input mt-2 w-full"
          />
        </div>
        <div>
          <label className="stat-label">Сайт</label>
          <input
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            className="input mt-2 w-full"
          />
        </div>
        <div>
          <label className="stat-label">Основной цвет</label>
          <div className="mt-2 flex items-center gap-3">
            <input
              type="color"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="h-10 w-16 cursor-pointer rounded-lg border-0"
            />
            <input
              type="text"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="input flex-1"
            />
          </div>
        </div>
        <div>
          <label className="stat-label">URL логотипа</label>
          <input
            type="url"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            className="input mt-2 w-full"
          />
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="text-lg font-medium text-white">Часы работы клуба</h2>
        <p className="text-xs text-slate-500">
          Смены сотрудников нельзя поставить вне этих окон.
        </p>
        <div className="space-y-2">
          {DAY_OF_WEEK_KEYS.map((key) => {
            const day = hours[key] ?? { open: '08:00', close: '22:00' };
            return (
              <div
                key={key}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 px-3 py-2"
              >
                <span className="w-28 text-sm text-white">{DAY_NAMES[key]}</span>
                <label className="flex items-center gap-1 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={!!day.closed}
                    onChange={(e) => setDay(key, { closed: e.target.checked })}
                  />
                  выходной
                </label>
                {!day.closed && (
                  <>
                    <input
                      type="time"
                      className="input w-auto"
                      value={day.open}
                      onChange={(e) => setDay(key, { open: e.target.value })}
                    />
                    <span className="text-slate-500">—</span>
                    <input
                      type="time"
                      className="input w-auto"
                      value={day.close}
                      onChange={(e) => setDay(key, { close: e.target.value })}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {error && <p className="text-red-400">{error}</p>}

      <button type="button" onClick={handleSave} className="btn-primary w-full">
        {saved ? 'Сохранено!' : 'Сохранить'}
      </button>

      <div className="card text-center" style={{ borderColor: primaryColor }}>
        <p className="text-sm text-slate-400">Превью</p>
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="Logo" className="mx-auto mt-2 h-12 object-contain" />
        )}
        <p className="mt-2 text-lg font-semibold" style={{ color: primaryColor }}>
          {name || 'Ваш клуб'}
        </p>
        {address && <p className="mt-1 text-sm text-slate-400">{address}</p>}
        {phone && <p className="text-sm text-slate-400">{phone}</p>}
        {website && <p className="text-sm text-fitgo-400">{website}</p>}
      </div>
    </div>
  );
}
