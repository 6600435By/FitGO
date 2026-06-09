'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export default function AdminSettingsPage() {
  const [primaryColor, setPrimaryColor] = useState('#14b88a');
  const [logoUrl, setLogoUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api
      .clubTheme(token)
      .then((theme) => {
        setPrimaryColor(theme.primaryColor);
        setLogoUrl(theme.logoUrl ?? '');
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    const token = getToken();
    if (!token) return;
    setError('');
    try {
      await api.updateClubTheme(token, {
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
      <h2 className="text-xl font-semibold">Брендинг клуба</h2>

      <div className="card space-y-4">
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

        <button onClick={handleSave} className="btn-primary w-full">
          {saved ? 'Сохранено!' : 'Сохранить'}
        </button>
      </div>

      <div
        className="card text-center"
        style={{ borderColor: primaryColor }}
      >
        <p className="text-sm text-slate-400">Превью</p>
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="Logo" className="mx-auto mt-2 h-12 object-contain" />
        )}
        <p className="mt-2 text-lg font-semibold" style={{ color: primaryColor }}>
          Ваш клуб
        </p>
      </div>
    </div>
  );
}
