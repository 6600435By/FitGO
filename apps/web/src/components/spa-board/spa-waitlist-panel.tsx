'use client';

import type { SpaService, SpaWaitlistEntry } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { toDatetimeLocalValue } from '@/components/spa-board/spa-booking-dialog';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SpaWaitlistPanel({
  entries,
  services,
  specialists,
  clients,
  defaultSpecialistId,
  defaultStartAt,
  allowPickSpecialist,
  busy,
  onReload,
  onBook,
  onMessage,
}: {
  entries: SpaWaitlistEntry[];
  services: SpaService[];
  specialists?: Array<{ id: string; firstName: string; lastName: string }>;
  clients: Array<{ id: string; firstName: string; lastName: string }>;
  defaultSpecialistId?: string;
  defaultStartAt?: string;
  allowPickSpecialist?: boolean;
  busy?: boolean;
  onReload: () => Promise<void>;
  onBook: (entry: SpaWaitlistEntry) => void;
  onMessage: (msg: string) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const bookable = services.filter((s) => s.active && (s.bookable ?? true));

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          Лист ожидания
          {entries.length > 0 ? (
            <span className="ml-2 text-slate-400">· {entries.length}</span>
          ) : null}
        </h3>
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={busy}
          onClick={() => setShowAdd(true)}
        >
          В лист
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-slate-500">На этот день заявок нет</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium">{e.clientName}</p>
                <p className="text-slate-400">
                  {e.serviceName} · {formatTime(e.desiredStartAt)}
                  {allowPickSpecialist ? ` · ${e.specialistName}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary px-3 py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => onBook(e)}
                >
                  Записать
                </button>
                <button
                  type="button"
                  className="btn-secondary px-3 py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => {
                    void (async () => {
                      const token = getToken();
                      if (!token) return;
                      try {
                        if (allowPickSpecialist) {
                          await api.adminCancelSpaWaitlist(token, e.id);
                        } else {
                          await api.specialistCancelSpaWaitlist(token, e.id);
                        }
                        onMessage('Заявка снята');
                        await onReload();
                      } catch (err) {
                        onMessage(
                          err instanceof Error ? err.message : 'Ошибка',
                        );
                      }
                    })();
                  }}
                >
                  Снять
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showAdd ? (
        <SpaWaitlistAddDialog
          open={showAdd}
          onClose={() => setShowAdd(false)}
          bookable={bookable}
          specialists={specialists}
          clients={clients}
          defaultSpecialistId={defaultSpecialistId}
          defaultStartAt={defaultStartAt}
          allowPickSpecialist={allowPickSpecialist}
          busy={busy}
          onCreated={async () => {
            setShowAdd(false);
            onMessage('Добавлено в лист ожидания');
            await onReload();
          }}
          onError={onMessage}
        />
      ) : null}
    </div>
  );
}

function SpaWaitlistAddDialog({
  open,
  onClose,
  bookable,
  specialists,
  clients,
  defaultSpecialistId,
  defaultStartAt,
  allowPickSpecialist,
  busy,
  onCreated,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  bookable: SpaService[];
  specialists?: Array<{ id: string; firstName: string; lastName: string }>;
  clients: Array<{ id: string; firstName: string; lastName: string }>;
  defaultSpecialistId?: string;
  defaultStartAt?: string;
  allowPickSpecialist?: boolean;
  busy?: boolean;
  onCreated: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<'base' | 'phone'>('phone');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    specialistId: defaultSpecialistId ?? '',
    clientId: '',
    guestName: '',
    guestPhone: '',
    serviceId: bookable[0]?.id ?? '',
    startAt: defaultStartAt || toDatetimeLocalValue(new Date()),
  });

  useEffect(() => {
    if (!open) return;
    setError('');
    setMode('phone');
    setForm({
      specialistId: defaultSpecialistId ?? '',
      clientId: '',
      guestName: '',
      guestPhone: '',
      serviceId: bookable[0]?.id ?? '',
      startAt: defaultStartAt || toDatetimeLocalValue(new Date()),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultSpecialistId, defaultStartAt]);

  if (!open) return null;

  const { datePart, timePart } = splitLocal(form.startAt);

  const submit = async () => {
    setError('');
    if (!form.serviceId) {
      setError('Выберите услугу');
      return;
    }
    if (allowPickSpecialist && !form.specialistId) {
      setError('Укажите специалиста');
      return;
    }
    if (mode === 'base' && !form.clientId) {
      setError('Выберите клиента');
      return;
    }
    if (mode === 'phone' && !form.clientId && !form.guestName.trim()) {
      setError('Укажите ФИО');
      return;
    }
    const startIso = new Date(form.startAt).toISOString();
    if (Number.isNaN(new Date(startIso).getTime())) {
      setError('Некорректная дата');
      return;
    }
    const token = getToken();
    if (!token) return;
    setSaving(true);
    try {
      const payload = {
        serviceId: form.serviceId,
        desiredStartAt: startIso,
        ...(mode === 'base'
          ? { clientId: form.clientId }
          : form.clientId
            ? { clientId: form.clientId, guestPhone: form.guestPhone }
            : {
                guestName: form.guestName,
                guestPhone: form.guestPhone,
              }),
      };
      if (allowPickSpecialist) {
        await api.adminCreateSpaWaitlist(token, {
          ...payload,
          specialistId: form.specialistId,
        });
      } else {
        await api.specialistCreateSpaWaitlist(token, payload);
      }
      await onCreated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка';
      setError(msg);
      onError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="card max-h-[min(92dvh,100%)] w-full max-w-md space-y-3 overflow-y-auto rounded-b-none sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">В лист ожидания</h3>
          <button type="button" className="btn-secondary text-xs" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <div className="flex gap-2 text-xs">
          <button
            type="button"
            className={mode === 'phone' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setMode('phone')}
          >
            Вручную
          </button>
          <button
            type="button"
            className={mode === 'base' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setMode('base')}
          >
            Из базы
          </button>
        </div>

        {allowPickSpecialist && specialists ? (
          <label className="block space-y-1 text-sm">
            <span className="text-slate-400">Специалист</span>
            <select
              className="input"
              value={form.specialistId}
              onChange={(e) =>
                setForm((f) => ({ ...f, specialistId: e.target.value }))
              }
            >
              <option value="">Выберите</option>
              {specialists.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.lastName} {s.firstName}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {mode === 'base' ? (
          <label className="block space-y-1 text-sm">
            <span className="text-slate-400">Клиент</span>
            <select
              className="input"
              value={form.clientId}
              onChange={(e) =>
                setForm((f) => ({ ...f, clientId: e.target.value }))
              }
            >
              <option value="">Выберите</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.lastName} {c.firstName}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="block space-y-1 text-sm">
              <span className="text-slate-400">Телефон</span>
              <input
                className="input"
                value={form.guestPhone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, guestPhone: e.target.value }))
                }
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-slate-400">ФИО</span>
              <input
                className="input"
                value={form.guestName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, guestName: e.target.value }))
                }
              />
            </label>
          </>
        )}

        <label className="block space-y-1 text-sm">
          <span className="text-slate-400">Услуга</span>
          <select
            className="input"
            value={form.serviceId}
            onChange={(e) =>
              setForm((f) => ({ ...f, serviceId: e.target.value }))
            }
          >
            {bookable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.durationMin} мин
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1 text-sm">
            <span className="text-[11px] text-slate-500">Дата</span>
            <input
              type="date"
              className="input date-field"
              value={datePart}
              onChange={(e) => {
                const time = timePart || '10:00';
                setForm((f) => ({
                  ...f,
                  startAt: e.target.value ? `${e.target.value}T${time}` : '',
                }));
              }}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-[11px] text-slate-500">Время</span>
            <input
              type="time"
              className="input date-field"
              step={300}
              value={timePart}
              onChange={(e) => {
                const date =
                  datePart || toDatetimeLocalValue(new Date()).slice(0, 10);
                setForm((f) => ({
                  ...f,
                  startAt: e.target.value
                    ? `${date}T${e.target.value}`
                    : `${date}T00:00`,
                }));
              }}
            />
          </label>
        </div>

        {error ? (
          <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          className="btn-primary w-full"
          disabled={busy || saving}
          onClick={() => {
            void submit();
          }}
        >
          {saving ? 'Сохраняем…' : 'Добавить'}
        </button>
      </div>
    </div>
  );
}

function splitLocal(value: string) {
  if (!value) return { datePart: '', timePart: '' };
  const [datePart = '', timeRaw = ''] = value.split('T');
  return { datePart, timePart: timeRaw.slice(0, 5) };
}
