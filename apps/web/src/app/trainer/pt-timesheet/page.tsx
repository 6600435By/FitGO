'use client';

import type {
  TrainerDaySheetDto,
  TrainerShiftDto,
} from '@fitgo/shared-types';
import { clientIssueLabel } from '@fitgo/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function money(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)}\u00a0${currency}`;
}

export default function TrainerPtTimesheetPage() {
  const today = useMemo(() => isoDate(new Date()), []);
  const [date, setDate] = useState(today);
  const [sheet, setSheet] = useState<TrainerDaySheetDto | null>(null);
  const [shifts, setShifts] = useState<TrainerShiftDto[]>([]);
  const [message, setMessage] = useState('');
  const [late, setLate] = useState({
    phone: '',
    firstName: '',
    lastName: '',
    time: '12:00',
    gift: false,
  });
  const [fixPhone, setFixPhone] = useState<Record<string, string>>({});

  const load = async () => {
    const token = getToken();
    if (!token) return;
    setMessage('');
    try {
      const [s, sh] = await Promise.all([
        api.trainerPtDaySheet(token, date),
        api.trainerPtShifts(token, date, date),
      ]);
      setSheet(s);
      setShifts(sh);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  useEffect(() => {
    load();
  }, [date]);

  const submit = async () => {
    const token = getToken();
    if (!token) return;
    try {
      const s = await api.trainerPtSubmitDay(token, date);
      setSheet(s);
      setMessage('Табель отправлен админу');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const lateAdd = async () => {
    const token = getToken();
    if (!token) return;
    try {
      const startAt = new Date(`${date}T${late.time}:00`);
      const s = await api.trainerPtLateAdd(token, {
        date,
        phone: late.phone,
        firstName: late.firstName,
        lastName: late.lastName,
        startAt: startAt.toISOString(),
        isComplimentary: late.gift,
      });
      setSheet(s);
      setLate({ phone: '', firstName: '', lastName: '', time: '12:00', gift: false });
      setMessage('Клиент добавлен в журнал (late-add)');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-white">Табель ПТ</h1>
        <p className="text-sm text-slate-400">
          Отчёт собирается из журнала записи. Без телефона клиента записать
          нельзя. Late-add и ошибочный телефон — исключения.
        </p>
      </header>

      <label className="block text-xs uppercase text-slate-500">
        Дата
        <input
          type="date"
          className="input mt-1 w-full sm:w-auto"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>

      {message && (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-200">
          {message}
        </p>
      )}

      <section className="space-y-3 rounded-2xl border border-slate-800 p-4">
        <h2 className="text-sm font-medium text-slate-300">Смена (из графика админа)</h2>
        <p className="text-xs text-slate-500">
          Рабочие смены вносит админ. Окна для записи клиентов открывайте в{' '}
          <a href="/trainer/schedule" className="text-fitgo-400 underline">
            Расписании
          </a>
          .
        </p>
        <ul className="space-y-1 text-sm text-slate-400">
          {shifts.length === 0 && <li>Нет смен на день</li>}
          {shifts.map((s) => (
            <li key={s.id} className="flex justify-between gap-2">
              <span>
                {new Date(s.startAt).toLocaleTimeString('ru-RU', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                –
                {new Date(s.endAt).toLocaleTimeString('ru-RU', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                ({s.minutes} мин) · {s.status}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {sheet && (
        <>
          <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Часы смены" value={`${(sheet.shiftMinutes / 60).toFixed(1)} ч`} />
            <Stat
              label="Оплата смены"
              value={money(sheet.shiftPayMinor, sheet.currency)}
            />
            <Stat
              label="Мотивация"
              value={money(sheet.sessionMotivationMinor, sheet.currency)}
            />
            <Stat
              label="Итого"
              value={money(sheet.totalMinor, sheet.currency)}
              emphasize
            />
          </section>
          <p className="text-xs text-slate-500">
            Статус: {sheet.status}
            {sheet.openClientIssues > 0 && (
              <span className="ml-2 text-amber-300">
                проблем с клиентом: {sheet.openClientIssues}
              </span>
            )}
          </p>

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-slate-300">
              Клиенты из журнала ({sheet.lines.length})
            </h2>
            {sheet.lines.map((l) => {
              const issue = l.clientIssue !== 'NONE';
              return (
                <article
                  key={l.id}
                  className={`rounded-xl border p-3 ${
                    issue
                      ? 'border-amber-500/40 bg-amber-500/5'
                      : 'border-slate-800 bg-slate-950/50'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-white">{l.clientName}</p>
                      <p className="text-xs text-slate-500">
                        {l.clientPhone ?? '—'} ·{' '}
                        {new Date(l.startAt).toLocaleTimeString('ru-RU', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {l.isLateAdd && (
                        <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] text-violet-300">
                          late-add
                        </span>
                      )}
                      {issue && (
                        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-200">
                          {clientIssueLabel(l.clientIssue) || l.clientIssue}
                        </span>
                      )}
                      {l.isComplimentary && (
                        <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px]">
                          подарок
                        </span>
                      )}
                      {l.verified1c && (
                        <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">
                          1С
                        </span>
                      )}
                    </div>
                  </div>
                  {issue && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input
                        className="input flex-1 text-sm"
                        placeholder="Верный телефон"
                        value={fixPhone[l.bookingId] ?? ''}
                        onChange={(e) =>
                          setFixPhone({
                            ...fixPhone,
                            [l.bookingId]: e.target.value,
                          })
                        }
                      />
                      <button
                        type="button"
                        className="btn-secondary text-sm"
                        onClick={async () => {
                          const token = getToken();
                          if (!token || !fixPhone[l.bookingId]) return;
                          const s = await api.trainerPtCorrectPhone(
                            token,
                            l.bookingId,
                            fixPhone[l.bookingId],
                          );
                          setSheet(s);
                        }}
                      >
                        Исправить
                      </button>
                      <button
                        type="button"
                        className="btn-secondary text-sm"
                        onClick={async () => {
                          const token = getToken();
                          if (!token) return;
                          setSheet(await api.trainerPtEscalate(token, l.bookingId));
                        }}
                      >
                        Админу
                      </button>
                      <button
                        type="button"
                        className="btn-secondary text-sm"
                        onClick={async () => {
                          const token = getToken();
                          if (!token) return;
                          setSheet(
                            await api.trainerPtNotThisClient(token, l.bookingId),
                          );
                        }}
                      >
                        Не тот клиент
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </section>

          <section className="space-y-2 rounded-2xl border border-dashed border-slate-700 p-4">
            <h3 className="text-sm font-medium text-slate-300">
              Late-add (исключение)
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                className="input"
                placeholder="Телефон *"
                value={late.phone}
                onChange={(e) => setLate({ ...late, phone: e.target.value })}
              />
              <input
                className="input"
                type="time"
                value={late.time}
                onChange={(e) => setLate({ ...late, time: e.target.value })}
              />
              <input
                className="input"
                placeholder="Имя"
                value={late.firstName}
                onChange={(e) => setLate({ ...late, firstName: e.target.value })}
              />
              <input
                className="input"
                placeholder="Фамилия"
                value={late.lastName}
                onChange={(e) => setLate({ ...late, lastName: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={late.gift}
                onChange={(e) => setLate({ ...late, gift: e.target.checked })}
              />
              Подарочная
            </label>
            <button type="button" className="btn-secondary" onClick={lateAdd}>
              В журнал с опозданием
            </button>
          </section>

          {(sheet.status === 'DRAFT' || sheet.status === 'TRAINER_SUBMITTED') && (
            <button type="button" className="btn-primary w-full" onClick={submit}>
              Подтвердить и отправить админу
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-3 ${
        emphasize
          ? 'border-fitgo-500/40 bg-fitgo-500/10'
          : 'border-slate-800 bg-slate-950/50'
      }`}
    >
      <p className="text-[10px] uppercase text-slate-500">{label}</p>
      <p
        className={`mt-1 font-semibold tabular-nums ${
          emphasize ? 'text-fitgo-300' : 'text-white'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
