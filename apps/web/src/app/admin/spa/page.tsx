'use client';

import type {
  SpaBoardResponse,
  SpaBooking,
  SpaQuotaRule,
  SpaService,
  SpaSpecialistSummary,
} from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SpaBoard } from '@/components/spa-board/spa-board';
import {
  SpaBookingDialog,
  toDatetimeLocalValue,
} from '@/components/spa-board/spa-booking-dialog';
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
  const [board, setBoard] = useState<SpaBoardResponse | null>(null);
  const [clients, setClients] = useState<
    Array<{ id: string; firstName: string; lastName: string }>
  >([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [day, setDay] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [filterSpecialistIds, setFilterSpecialistIds] = useState<string[]>([]);
  const [filterApproval, setFilterApproval] = useState('ALL');
  const [showAssign, setShowAssign] = useState(false);
  const [assignDefaults, setAssignDefaults] = useState<{
    specialistId?: string;
    startAt?: string;
  }>({});
  const [ruleDraft, setRuleDraft] = useState({
    membershipServiceName: 'Массаж классический общий',
    allowedServiceIds: [] as string[],
    allowedSpecialistIds: [] as string[],
  });

  const period = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 14);
    return { start: start.toISOString(), end: end.toISOString() };
  }, []);

  const boardPeriod = useMemo(() => {
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }, [day]);

  const reload = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    const [svc, rls, sps, bks, cls, brd] = await Promise.all([
      api.adminSpaServices(token),
      api.adminSpaQuotaRules(token),
      api.adminSpaSpecialists(token),
      api.adminSpaCalendar(token, period.start, period.end),
      api.adminSpaClients(token),
      api.adminSpaBoard(token, boardPeriod.start, boardPeriod.end, {
        specialistIds: filterSpecialistIds.length
          ? filterSpecialistIds
          : undefined,
        approval: filterApproval !== 'ALL' ? filterApproval : undefined,
      }),
    ]);
    setServices(svc);
    setRules(rls);
    setSpecialists(sps);
    setBookings(bks);
    setClients(cls);
    setBoard(brd);
  }, [
    boardPeriod.end,
    boardPeriod.start,
    filterApproval,
    filterSpecialistIds,
    period.end,
    period.start,
  ]);

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

  const assignFromDialog = async (payload: {
    specialistId?: string;
    clientId?: string;
    guestName?: string;
    guestPhone?: string;
    serviceId: string;
    startAt: string;
    paymentType: 'QUOTA' | 'PAID';
  }) => {
    const token = getToken();
    if (!token) return;
    if (!payload.specialistId) {
      setMessage('Укажите специалиста');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await api.adminAssignSpaBooking(token, {
        specialistId: payload.specialistId,
        serviceId: payload.serviceId,
        startAt: payload.startAt,
        paymentType: payload.paymentType,
        clientId: payload.clientId,
        guestName: payload.guestName,
        guestPhone: payload.guestPhone,
      });
      setShowAssign(false);
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
            ['calendar', 'Расписание'],
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
        <div className="space-y-3">
          <div className="flex justify-end">
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={busy}
              onClick={async () => {
                const token = getToken();
                if (!token) return;
                setBusy(true);
                try {
                  const res = await api.superAdminSyncNomenclatureFrom1C(
                    token,
                    'spa',
                  );
                  const r = res.results[0];
                  setMessage(
                    r
                      ? `Из 1С SPA: +${r.added}, upd ${r.updated}, off ${r.deactivated}${r.error ? ` (${r.error})` : ''}`
                      : 'Sync выполнен',
                  );
                  await reload();
                } catch (err) {
                  setMessage(err instanceof Error ? err.message : 'Ошибка sync');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Обновить из 1С
            </button>
          </div>
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
        </div>
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
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setAssignDefaults({});
                setShowAssign(true);
              }}
            >
              Новая запись
            </button>
            <select
              className="input text-sm"
              value={filterApproval}
              onChange={(e) => setFilterApproval(e.target.value)}
            >
              <option value="ALL">Все статусы подтверждения</option>
              <option value="PENDING">Ждут подтверждения</option>
              <option value="PENDING_PERFORMER">Ждёт специалиста</option>
              <option value="PENDING_ADMIN">Ждёт администратора</option>
              <option value="APPROVED">Подтверждено</option>
            </select>
            <select
              className="input text-sm"
              value={filterSpecialistIds[0] ?? ''}
              onChange={(e) =>
                setFilterSpecialistIds(
                  e.target.value ? [e.target.value] : [],
                )
              }
            >
              <option value="">Все специалисты</option>
              {specialists.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.lastName} {s.firstName}
                </option>
              ))}
            </select>
          </div>

          {board ? (
            <SpaBoard
              board={board}
              mode="admin"
              day={day}
              onDayChange={setDay}
              onEmptySlotClick={({ specialistId, startAt }) => {
                setAssignDefaults({
                  specialistId,
                  startAt: toDatetimeLocalValue(startAt),
                });
                setShowAssign(true);
              }}
            />
          ) : (
            <p className="text-sm text-slate-400">Загрузка доски…</p>
          )}

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

          <SpaBookingDialog
            key={`${showAssign}-${assignDefaults.specialistId ?? ''}-${assignDefaults.startAt ?? ''}`}
            open={showAssign}
            onClose={() => setShowAssign(false)}
            services={services}
            clients={clients}
            specialists={specialists}
            allowPickSpecialist
            defaultSpecialistId={assignDefaults.specialistId}
            defaultStartAt={assignDefaults.startAt}
            busy={busy}
            onSubmit={assignFromDialog}
          />
        </div>
      )}
    </div>
  );
}
