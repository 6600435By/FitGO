'use client';

import type {
  SpaBooking,
  SpaQuotaRule,
  SpaService,
  SpaSpecialistSummary,
} from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

function formatPrice(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

export default function AdminSpaPage() {
  const [tab, setTab] = useState<'services' | 'rules' | 'specialists' | 'calendar'>(
    'services',
  );
  const [services, setServices] = useState<SpaService[]>([]);
  const [rules, setRules] = useState<SpaQuotaRule[]>([]);
  const [specialists, setSpecialists] = useState<SpaSpecialistSummary[]>([]);
  const [bookings, setBookings] = useState<SpaBooking[]>([]);
  const [clients, setClients] = useState<
    Array<{ id: string; firstName: string; lastName: string }>
  >([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [ruleDraft, setRuleDraft] = useState({
    membershipServiceName: 'Массаж классический общий',
    allowedServiceIds: [] as string[],
    allowedSpecialistIds: [] as string[],
  });
  const [assignForm, setAssignForm] = useState({
    clientId: '',
    specialistId: '',
    serviceId: '',
    startAt: '',
    paymentType: 'PAID' as 'QUOTA' | 'PAID',
  });

  const period = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 14);
    return { start: start.toISOString(), end: end.toISOString() };
  }, []);

  const reload = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    const [svc, rls, sps, bks, cls] = await Promise.all([
      api.adminSpaServices(token),
      api.adminSpaQuotaRules(token),
      api.adminSpaSpecialists(token),
      api.adminSpaCalendar(token, period.start, period.end),
      api.adminSpaClients(token),
    ]);
    setServices(svc);
    setRules(rls);
    setSpecialists(sps);
    setBookings(bks);
    setClients(cls);
  }, [period.end, period.start]);

  useEffect(() => {
    reload().catch((err) =>
      setMessage(err instanceof Error ? err.message : 'Ошибка загрузки'),
    );
  }, [reload]);

  const saveRules = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      const next = [
        ...rules.filter(
          (r) => r.membershipServiceName !== ruleDraft.membershipServiceName,
        ),
        {
          membershipServiceName: ruleDraft.membershipServiceName.trim(),
          allowedServiceIds: ruleDraft.allowedServiceIds,
          allowedSpecialistIds: ruleDraft.allowedSpecialistIds,
        },
      ].filter((r) => r.membershipServiceName && r.allowedServiceIds.length > 0);
      const updated = await api.adminSetSpaQuotaRules(token, next);
      setRules(updated);
      setMessage('Правила квоты сохранены');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка');
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
    const sp = specialists.find((s) => s.id === specialistId);
    if (!sp) return;
    const next = sp.serviceIds.includes(serviceId)
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
      setMessage(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const assign = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      await api.adminAssignSpaBooking(token, assignForm);
      setMessage('Клиент записан');
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка записи');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Спа</h2>
      {message && (
        <p className="rounded-xl bg-fitgo-500/10 px-3 py-2 text-sm text-fitgo-300">
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['services', 'Услуги'],
            ['rules', 'Правила квоты'],
            ['specialists', 'Специалисты'],
            ['calendar', 'Календарь'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-full px-3 py-1.5 text-sm ${
              tab === key ? 'bg-fitgo-500 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'services' && (
        <ul className="space-y-2">
          {services.map((s) => (
            <li key={s.id} className="card flex justify-between gap-2 text-sm">
              <div>
                <p className="font-medium">{s.name}</p>
                <p className="text-slate-400">
                  {s.kind} · {s.durationMin} мин · buffer {s.bufferMin}
                </p>
              </div>
              <div className="text-right">
                <p>{formatPrice(s.priceMinor, s.currency)}</p>
                <p className="text-xs text-slate-500">
                  {s.active ? 'активна' : 'скрыта'}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {tab === 'rules' && (
        <div className="space-y-4">
          <div className="card space-y-3">
            <h3 className="font-medium">Правило для услуги абонемента</h3>
            <label className="block text-sm">
              <span className="text-slate-400">Название в абонементе (1С)</span>
              <input
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2"
                value={ruleDraft.membershipServiceName}
                onChange={(e) =>
                  setRuleDraft((d) => ({
                    ...d,
                    membershipServiceName: e.target.value,
                  }))
                }
              />
            </label>
            <div>
              <p className="mb-2 text-sm text-slate-400">Разрешённые услуги</p>
              <div className="flex flex-wrap gap-2">
                {services.map((s) => {
                  const on = ruleDraft.allowedServiceIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`rounded-full px-3 py-1 text-xs ${
                        on ? 'bg-fitgo-500 text-white' : 'bg-slate-800'
                      }`}
                      onClick={() =>
                        setRuleDraft((d) => ({
                          ...d,
                          allowedServiceIds: on
                            ? d.allowedServiceIds.filter((id) => id !== s.id)
                            : [...d.allowedServiceIds, s.id],
                        }))
                      }
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm text-slate-400">Разрешённые специалисты</p>
              <div className="flex flex-wrap gap-2">
                {specialists.map((sp) => {
                  const on = ruleDraft.allowedSpecialistIds.includes(sp.id);
                  return (
                    <button
                      key={sp.id}
                      type="button"
                      className={`rounded-full px-3 py-1 text-xs ${
                        on ? 'bg-fitgo-500 text-white' : 'bg-slate-800'
                      }`}
                      onClick={() =>
                        setRuleDraft((d) => ({
                          ...d,
                          allowedSpecialistIds: on
                            ? d.allowedSpecialistIds.filter((id) => id !== sp.id)
                            : [...d.allowedSpecialistIds, sp.id],
                        }))
                      }
                    >
                      {sp.firstName} {sp.lastName}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={saveRules}
            >
              Сохранить правило
            </button>
          </div>
          <ul className="space-y-2 text-sm">
            {rules.map((r) => (
              <li key={r.id} className="card">
                <p className="font-medium">{r.membershipServiceName}</p>
                <p className="text-slate-400">
                  услуг: {r.allowedServiceIds.length}, специалистов:{' '}
                  {r.allowedSpecialistIds.length}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'specialists' && (
        <ul className="space-y-3">
          {specialists.map((sp) => (
            <li key={sp.id} className="card space-y-2">
              <p className="font-medium">
                {sp.firstName} {sp.lastName}
              </p>
              <div className="flex flex-wrap gap-2">
                {services.map((s) => {
                  const on = sp.serviceIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={busy}
                      className={`rounded-full px-2 py-1 text-xs ${
                        on ? 'bg-fitgo-500/30 text-fitgo-200' : 'bg-slate-800 text-slate-500'
                      }`}
                      onClick={() => toggleSpecialistService(sp.id, s.id)}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
          {specialists.length === 0 && (
            <li className="card text-slate-400">
              Нет специалистов — создайте через супер-админ → сотрудники
            </li>
          )}
        </ul>
      )}

      {tab === 'calendar' && (
        <div className="space-y-4">
          <div className="card space-y-3">
            <h3 className="font-medium">Добавить запись</h3>
            <select
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              value={assignForm.clientId}
              onChange={(e) =>
                setAssignForm((f) => ({ ...f, clientId: e.target.value }))
              }
            >
              <option value="">Клиент</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName}
                </option>
              ))}
            </select>
            <select
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              value={assignForm.specialistId}
              onChange={(e) =>
                setAssignForm((f) => ({ ...f, specialistId: e.target.value }))
              }
            >
              <option value="">Специалист</option>
              {specialists.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.firstName} {s.lastName}
                </option>
              ))}
            </select>
            <select
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              value={assignForm.serviceId}
              onChange={(e) =>
                setAssignForm((f) => ({ ...f, serviceId: e.target.value }))
              }
            >
              <option value="">Услуга</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              type="datetime-local"
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              onChange={(e) =>
                setAssignForm((f) => ({
                  ...f,
                  startAt: e.target.value
                    ? new Date(e.target.value).toISOString()
                    : '',
                }))
              }
            />
            <select
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              value={assignForm.paymentType}
              onChange={(e) =>
                setAssignForm((f) => ({
                  ...f,
                  paymentType: e.target.value as 'QUOTA' | 'PAID',
                }))
              }
            >
              <option value="PAID">Платно</option>
              <option value="QUOTA">По абонементу</option>
            </select>
            <button
              type="button"
              className="btn-primary w-full"
              disabled={busy}
              onClick={assign}
            >
              Записать
            </button>
          </div>
          <ul className="space-y-2">
            {bookings.map((b) => (
              <li key={b.id} className="card text-sm">
                <p className="font-medium">{b.serviceName}</p>
                <p className="text-slate-300">
                  {b.clientName} → {b.specialistName}
                </p>
                <p className="text-slate-400">
                  {formatDateTime(b.startAt)} ·{' '}
                  {b.paymentType === 'QUOTA' ? 'абонемент' : 'платно'}
                </p>
              </li>
            ))}
            {bookings.length === 0 && (
              <li className="card text-slate-400">Записей нет</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
