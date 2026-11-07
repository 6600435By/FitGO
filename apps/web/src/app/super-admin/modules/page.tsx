'use client';

import {
  UserRole,
  type ProductModuleKey,
  type ProductModulesState,
  type StaffMember,
} from '@fitgo/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

type CatalogItem = {
  key: ProductModuleKey;
  label: string;
  description: string;
  defaultEnabled: boolean;
  enabled: boolean;
  pilotable?: boolean;
};

type PilotMember = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
};

export default function SuperAdminModulesPage() {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [pilots, setPilots] = useState<
    Partial<Record<ProductModuleKey, PilotMember[]>>
  >({});
  const [trainers, setTrainers] = useState<StaffMember[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    const token = getToken();
    if (!token) return;
    Promise.all([
      api.superAdminModules(token),
      api.superAdminStaff(token),
    ])
      .then(([modulesRes, staff]) => {
        setCatalog(modulesRes.catalog);
        setPilots(modulesRes.pilots ?? {});
        setTrainers(
          staff.filter(
            (s) =>
              s.isActive &&
              !s.archivedAt &&
              s.roles.includes(UserRole.TRAINER),
          ),
        );
      })
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

  const savePilots = async (key: ProductModuleKey, userIds: string[]) => {
    const token = getToken();
    if (!token) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await api.superAdminSetModulePilots(token, key, userIds);
      setCatalog(res.catalog);
      setPilots(res.pilots ?? {});
      setMessage('Список пилота сохранён.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const addPilot = (key: ProductModuleKey, userId: string) => {
    const current = pilots[key] ?? [];
    if (current.some((p) => p.id === userId)) return;
    const member = trainers.find((t) => t.id === userId);
    if (!member) return;
    void savePilots(key, [...current.map((p) => p.id), userId]);
  };

  const removePilot = (key: ProductModuleKey, userId: string) => {
    const current = pilots[key] ?? [];
    void savePilots(
      key,
      current.filter((p) => p.id !== userId).map((p) => p.id),
    );
  };

  const filteredTrainers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return trainers.slice(0, 12);
    return trainers
      .filter((t) => {
        const hay =
          `${t.lastName} ${t.firstName} ${t.email} ${t.phone ?? ''}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 12);
  }, [trainers, query]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Модули FitGO</h2>
        <p className="mt-1 hidden text-sm text-slate-400 sm:block">
          Включайте и выключайте поверхности по мере готовности. По умолчанию
          почти всё ON; магазин абонементов и wearables — OFF. Forma Coach
          можно открыть только списку пилотных тренеров, не включая глобально.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {message && <p className="text-sm text-fitgo-400">{message}</p>}

      <ul className="space-y-2">
        {catalog.map((item) => (
          <li key={item.key} className="card space-y-3">
            <div className="flex items-start justify-between gap-4">
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
            </div>

            {item.pilotable && (
              <div className="rounded-lg border border-slate-700/80 bg-slate-900/40 p-3">
                <p className="text-sm font-medium text-slate-200">Пилот</p>
                {item.enabled ? (
                  <p className="mt-1 text-sm text-amber-300/90">
                    Модуль включён глобально — Forma у всех тренеров. Список
                    пилота не действует, пока тумблер «Вкл».
                  </p>
                ) : (
                  <>
                    <p className="mt-1 text-xs text-slate-400">
                      Тумблер выключен: Forma только у тренеров ниже. Остальные
                      видят старый кабинет.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(pilots[item.key] ?? []).length === 0 && (
                        <span className="text-xs text-slate-500">
                          Список пуст
                        </span>
                      )}
                      {(pilots[item.key] ?? []).map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          disabled={saving}
                          onClick={() => removePilot(item.key, p.id)}
                          className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700"
                          title="Убрать из пилота"
                        >
                          {p.lastName} {p.firstName}
                          <span className="ml-1 text-slate-500">×</span>
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Найти тренера…"
                        className="input w-full sm:max-w-xs"
                      />
                    </div>
                    {query.trim() && (
                      <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm">
                        {filteredTrainers.map((t) => {
                          const inPilot = (pilots[item.key] ?? []).some(
                            (p) => p.id === t.id,
                          );
                          return (
                            <li key={t.id}>
                              <button
                                type="button"
                                disabled={saving || inPilot}
                                onClick={() => addPilot(item.key, t.id)}
                                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-slate-800 disabled:opacity-40"
                              >
                                <span>
                                  {t.lastName} {t.firstName}
                                  <span className="ml-2 text-xs text-slate-500">
                                    {t.email}
                                  </span>
                                </span>
                                <span className="text-xs text-fitgo-400">
                                  {inPilot ? 'в пилоте' : 'добавить'}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                        {filteredTrainers.length === 0 && (
                          <li className="px-2 text-xs text-slate-500">
                            Никого не найдено
                          </li>
                        )}
                      </ul>
                    )}
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
