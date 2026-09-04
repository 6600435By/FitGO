'use client';

import type { ProductModuleKey, ProductModulesState } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export default function SuperAdminModulesPage() {
  const [catalog, setCatalog] = useState<
    Array<{
      key: ProductModuleKey;
      label: string;
      description: string;
      defaultEnabled: boolean;
      enabled: boolean;
    }>
  >([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    const token = getToken();
    if (!token) return;
    api
      .superAdminModules(token)
      .then((res) => setCatalog(res.catalog))
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = async (key: ProductModuleKey, enabled: boolean) => {
    const token = getToken();
    if (!token) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const next: Partial<ProductModulesState> = { [key]: enabled };
      await api.superAdminSetModules(token, next);
      setCatalog((prev) =>
        prev.map((item) => (item.key === key ? { ...item, enabled } : item)),
      );
      setMessage('Сохранено — клиенты подхватят при следующем обновлении.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Модули FitGO</h2>
        <p className="mt-1 text-sm text-slate-400">
          Включайте и выключайте поверхности по мере готовности. По умолчанию
          почти всё ON; магазин абонементов и wearables — OFF.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {message && <p className="text-sm text-fitgo-400">{message}</p>}

      <ul className="space-y-2">
        {catalog.map((item) => (
          <li
            key={item.key}
            className="card flex items-start justify-between gap-4"
          >
            <div>
              <p className="font-medium">{item.label}</p>
              <p className="text-sm text-slate-400">{item.description}</p>
              <p className="mt-1 text-xs text-slate-500">{item.key}</p>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() => toggle(item.key, !item.enabled)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${
                item.enabled
                  ? 'bg-fitgo-500/20 text-fitgo-300'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {item.enabled ? 'Вкл' : 'Выкл'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
