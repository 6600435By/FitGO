'use client';

import type { SpaService, SpaSpecialistSummary } from '@fitgo/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function formatPrice(minor: number | null | undefined, currency = 'BYN') {
  if (minor == null) return '—';
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

export default function SuperAdminSpaCatalogPage() {
  const [services, setServices] = useState<SpaService[]>([]);
  const [specialists, setSpecialists] = useState<SpaSpecialistSummary[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<
    Record<
      string,
      {
        durationMin: string;
        bufferMin: string;
        overrideRub: string;
        bookable: boolean;
        active: boolean;
      }
    >
  >({});

  const reload = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    const [svc, sps] = await Promise.all([
      api.adminSpaServices(token),
      api.adminSpaSpecialists(token),
    ]);
    setServices(svc);
    setSpecialists(sps);
    const next: typeof drafts = {};
    for (const s of svc) {
      next[s.id] = {
        durationMin: String(s.durationMin),
        bufferMin: String(s.bufferMin),
        overrideRub:
          s.priceOverrideMinor != null
            ? (s.priceOverrideMinor / 100).toFixed(2)
            : '',
        bookable: Boolean(s.bookable ?? true),
        active: s.active,
      };
    }
    setDrafts(next);
  }, []);

  useEffect(() => {
    reload().catch((err) =>
      setMessage(err instanceof Error ? err.message : 'Ошибка загрузки'),
    );
  }, [reload]);

  const syncFrom1c = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setMessage('');
    try {
      const res = await api.superAdminSyncNomenclatureFrom1C(token, 'spa');
      const spa = res.results.find((r) => r.key.includes('spa')) ?? res.results[0];
      setMessage(
        spa?.error
          ? `Ошибка синхронизации: ${spa.error}`
          : `Из 1С: +${spa?.added ?? 0} · обновлено ${spa?.updated ?? 0} · без изменений ${spa?.unchanged ?? 0} · скрыто ${spa?.deactivated ?? 0}`,
      );
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка синхронизации');
    } finally {
      setBusy(false);
    }
  };

  const saveRow = async (s: SpaService) => {
    const token = getToken();
    if (!token) return;
    const d = drafts[s.id];
    if (!d) return;
    setBusy(true);
    setMessage('');
    try {
      const overrideTrim = d.overrideRub.trim();
      const priceOverrideMinor =
        overrideTrim === ''
          ? null
          : Math.round(Number(overrideTrim.replace(',', '.')) * 100);
      if (priceOverrideMinor != null && Number.isNaN(priceOverrideMinor)) {
        throw new Error('Некорректная своя цена');
      }
      const durationMin = Number(d.durationMin);
      const bufferMin = Number(d.bufferMin);
      if (!Number.isFinite(durationMin) || durationMin < 5) {
        throw new Error('Длительность должна быть ≥ 5 мин');
      }
      await api.adminUpsertSpaService(token, {
        id: s.id,
        name: s.name,
        kind: s.kind,
        durationMin,
        bufferMin: Number.isFinite(bufferMin) ? bufferMin : 0,
        priceMinor: s.priceMinor,
        priceOverrideMinor,
        bookable: d.bookable,
        active: d.active,
        currency: s.currency,
      });
      setMessage(`Сохранено: ${s.name}`);
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  };

  const toggleSpecialistService = async (
    specialistId: string,
    serviceId: string,
  ) => {
    const token = getToken();
    if (!token) return;
    const sp = specialists.find((x) => x.id === specialistId);
    if (!sp) return;
    const on = sp.serviceIds.includes(serviceId);
    const next = on
      ? sp.serviceIds.filter((id) => id !== serviceId)
      : [...sp.serviceIds, serviceId];
    setBusy(true);
    try {
      const updated = await api.adminSetSpecialistServices(
        token,
        specialistId,
        next,
      );
      setSpecialists(updated);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка специалистов');
    } finally {
      setBusy(false);
    }
  };

  const deleteRow = async (s: SpaService) => {
    const token = getToken();
    if (!token) return;
    if (
      !window.confirm(
        `Удалить «${s.name}» из каталога? Если есть записи — услуга будет скрыта (неактивна).`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const res = await api.adminDeleteSpaService(token, s.id);
      setMessage(
        res.deleted
          ? `Удалено: ${s.name}`
          : `Скрыто (есть записи): ${s.name}`,
      );
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка удаления');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold sm:text-xl">Каталог SPA</h2>
          <p className="text-xs text-slate-400 sm:text-sm">
            Сегмент 1С «SPA кабинет приложение» → цены и видимость в записи. Новые
            услуги из 1С скрыты, пока не включите «В записи». Если sync не находит
            сегмент — обновите FitGOIntegration (BSL) и переопубликуйте HTTP.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary !px-3 !py-1.5 text-sm"
          disabled={busy}
          onClick={syncFrom1c}
        >
          Обновить из 1С
        </button>
      </div>

      {message ? (
        <p className="rounded-xl bg-fitgo-500/10 px-3 py-2 text-sm text-fitgo-300">
          {message}
        </p>
      ) : null}

      <div className="space-y-2 md:hidden">
        {services.map((s) => {
          const d = drafts[s.id];
          if (!d) return null;
          return (
            <div key={s.id} className="card !p-3 space-y-2">
              <div>
                <p className="font-medium text-slate-100">{s.name}</p>
                <p className="text-xs text-slate-500">
                  {s.kind} · 1С {formatPrice(s.priceFromOneCMinor, s.currency)} ·
                  эффект. {formatPrice(s.priceMinor, s.currency)}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-slate-400">
                  Своя цена
                  <input
                    className="input mt-1"
                    value={d.overrideRub}
                    placeholder="как в 1С"
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [s.id]: { ...d, overrideRub: e.target.value },
                      }))
                    }
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Мин
                  <input
                    className="input mt-1"
                    value={d.durationMin}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [s.id]: { ...d, durationMin: e.target.value },
                      }))
                    }
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Перерыв
                  <input
                    className="input mt-1"
                    value={d.bufferMin}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [s.id]: { ...d, bufferMin: e.target.value },
                      }))
                    }
                  />
                </label>
                <div className="flex flex-col justify-end gap-1 text-xs">
                  <label className="flex items-center gap-2 text-slate-300">
                    <input
                      type="checkbox"
                      checked={d.bookable}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [s.id]: { ...d, bookable: e.target.checked },
                        }))
                      }
                    />
                    В записи
                  </label>
                  <label className="flex items-center gap-2 text-slate-300">
                    <input
                      type="checkbox"
                      checked={d.active}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [s.id]: { ...d, active: e.target.checked },
                        }))
                      }
                    />
                    Активна
                  </label>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {specialists.map((sp) => {
                  const on = sp.serviceIds.includes(s.id);
                  return (
                    <button
                      key={sp.id}
                      type="button"
                      disabled={busy}
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        on
                          ? 'bg-fitgo-500/30 text-fitgo-200'
                          : 'bg-slate-800 text-slate-500'
                      }`}
                      onClick={() => toggleSpecialistService(sp.id, s.id)}
                    >
                      {sp.lastName}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary flex-1 !px-3 !py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => saveRow(s)}
                >
                  Сохранить
                </button>
                <button
                  type="button"
                  className="btn-secondary !px-3 !py-1.5 text-xs text-rose-300"
                  disabled={busy}
                  onClick={() => void deleteRow(s)}
                >
                  Удалить
                </button>
              </div>
            </div>
          );
        })}
        {services.length === 0 ? (
          <p className="px-1 py-4 text-sm text-slate-400">
            Каталог пуст — нажмите «Обновить из 1С».
          </p>
        ) : null}
      </div>

      <div className="card hidden overflow-x-auto overscroll-x-contain md:block">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-2">Услуга</th>
              <th className="px-2 py-2">Цена 1С</th>
              <th className="px-2 py-2">Своя цена</th>
              <th className="px-2 py-2">Эффект.</th>
              <th className="px-2 py-2">Мин</th>
              <th className="px-2 py-2">Перерыв</th>
              <th className="px-2 py-2">В записи</th>
              <th className="px-2 py-2">Активна</th>
              <th className="px-2 py-2">Специалисты</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {services.map((s) => {
              const d = drafts[s.id];
              if (!d) return null;
              return (
                <tr key={s.id} className="border-t border-slate-800 align-top">
                  <td className="px-2 py-2">
                    <p className="font-medium text-slate-100">{s.name}</p>
                    <p className="text-xs text-slate-500">{s.kind}</p>
                  </td>
                  <td className="px-2 py-2 text-slate-300">
                    {formatPrice(s.priceFromOneCMinor, s.currency)}
                  </td>
                  <td className="px-2 py-2">
                    <input
                      className="input w-24"
                      value={d.overrideRub}
                      placeholder="как в 1С"
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [s.id]: { ...d, overrideRub: e.target.value },
                        }))
                      }
                    />
                  </td>
                  <td className="px-2 py-2 text-slate-300">
                    {formatPrice(s.priceMinor, s.currency)}
                  </td>
                  <td className="px-2 py-2">
                    <input
                      className="input w-16"
                      value={d.durationMin}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [s.id]: { ...d, durationMin: e.target.value },
                        }))
                      }
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      className="input w-16"
                      value={d.bufferMin}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [s.id]: { ...d, bufferMin: e.target.value },
                        }))
                      }
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={d.bookable}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [s.id]: { ...d, bookable: e.target.checked },
                        }))
                      }
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={d.active}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [s.id]: { ...d, active: e.target.checked },
                        }))
                      }
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex max-w-xs flex-wrap gap-1">
                      {specialists.map((sp) => {
                        const on = sp.serviceIds.includes(s.id);
                        return (
                          <button
                            key={sp.id}
                            type="button"
                            disabled={busy}
                            className={`rounded-full px-2 py-0.5 text-[11px] ${
                              on
                                ? 'bg-fitgo-500/30 text-fitgo-200'
                                : 'bg-slate-800 text-slate-500'
                            }`}
                            onClick={() => toggleSpecialistService(sp.id, s.id)}
                          >
                            {sp.lastName}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        disabled={busy}
                        onClick={() => saveRow(s)}
                      >
                        Сохранить
                      </button>
                      <button
                        type="button"
                        className="btn-secondary text-xs text-rose-300"
                        disabled={busy}
                        onClick={() => void deleteRow(s)}
                      >
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {services.length === 0 ? (
          <p className="px-3 py-6 text-sm text-slate-400">
            Каталог пуст — нажмите «Обновить из 1С».
          </p>
        ) : null}
      </div>
    </div>
  );
}
