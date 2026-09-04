'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export default function AdminSettingsPage() {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#14b88a');
  const [logoUrl, setLogoUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api
      .adminClubProfile(token)
      .then((profile) => {
        setName(profile.name);
        setAddress(profile.address ?? '');
        setPhone(profile.phone ?? '');
        setWebsite(profile.website ?? '');
        setPrimaryColor(profile.theme.primaryColor);
        setLogoUrl(profile.theme.logoUrl ?? '');
      })
      .catch(() => {
        api
          .clubTheme(token)
          .then((theme) => {
            setName(theme.clubName);
            setAddress(theme.address ?? '');
            setPhone(theme.phone ?? '');
            setWebsite(theme.website ?? '');
            setPrimaryColor(theme.primaryColor);
            setLogoUrl(theme.logoUrl ?? '');
          })
          .catch(() => {});
      });
  }, []);

  const handleSave = async () => {
    const token = getToken();
    if (!token) return;
    setError('');
    try {
      await api.adminUpdateClubProfile(token, {
        name: name.trim(),
        address: address.trim(),
        phone: phone.trim(),
        website: website.trim(),
        primaryColor,
        logoUrl: logoUrl || undefined,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Клуб и брендинг</h2>

      <div className="card space-y-4">
        <div>
          <label className="stat-label">Название клуба</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input mt-2 w-full"
            placeholder="Форма"
          />
        </div>

        <div>
          <label className="stat-label">Адрес</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="input mt-2 w-full"
            placeholder="ул. …"
          />
        </div>

        <div>
          <label className="stat-label">Телефон</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="input mt-2 w-full"
            placeholder="+375 …"
          />
        </div>

        <div>
          <label className="stat-label">Сайт</label>
          <input
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            className="input mt-2 w-full"
            placeholder="https://ffs.by"
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
            placeholder="https://..."
            className="input mt-2 w-full"
          />
        </div>

        {error && <p className="text-red-400">{error}</p>}

        <button type="button" onClick={handleSave} className="btn-primary w-full">
          {saved ? 'Сохранено!' : 'Сохранить'}
        </button>
      </div>

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
