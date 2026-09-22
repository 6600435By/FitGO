'use client';

import type {
  ClubWorkingHours,
  DayOfWeekKey,
  StaffHourlySummary,
  StaffShiftDto,
  StaffShiftMonthCell,
  StaffShiftTrack,
} from '@fitgo/shared-types';
import {
  DAY_OF_WEEK_KEYS,
  DEFAULT_CLUB_WORKING_HOURS,
  dayKeyFromDate,
} from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

const TRACKS: Array<{ id: StaffShiftTrack; label: string }> = [
  { id: 'ADMIN', label: 'Админы' },
  { id: 'TRAINER', label: 'Тренеры' },
  { id: 'TECH', label: 'Техперсонал' },
];

const DAY_LABELS: Record<DayOfWeekKey, string> = {
  monday: 'Пн',
  tuesday: 'Вт',
  wednesday: 'Ср',
  thursday: 'Чт',
  friday: 'Пт',
  saturday: 'Сб',
  sunday: 'Вс',
};

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString('ru-RU', {
    month: 'long',
    year: 'numeric',
  });
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function timeOf(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function money(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)}\u00a0${currency}`;
}

type StaffOption = { id: string; name: string };

type Props = {
  mode: 'admin' | 'super' | 'trainer';
  /** When true, show hourly pay summary panel. */
  showMotivation?: boolean;
};

export function StaffRosterCalendar({ mode, showMotivation }: Props) {
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [track, setTrack] = useState<StaffShiftTrack>(
    mode === 'trainer' ? 'TRAINER' : 'ADMIN',
  );
  const [cells, setCells] = useState<StaffShiftMonthCell[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [hours, setHours] = useState<ClubWorkingHours>(DEFAULT_CLUB_WORKING_HOURS);
  const [summary, setSummary] = useState<StaffHourlySummary | StaffHourlySummary[] | null>(
    null,
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editShift, setEditShift] = useState<StaffShiftDto | null>(null);
  const [userId, setUserId] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const canEdit = mode === 'admin' || mode === 'super';
  const firstWeekday = useMemo(() => {
    // Mon=0 … Sun=6 for grid
    const dow = new Date(year, month - 1, 1).getDay();
    return dow === 0 ? 6 : dow - 1;
  }, [year, month]);

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setMessage('');
    try {
      if (mode === 'trainer') {
        const monthCells = await api.trainerRosterMyMonth(token, year, month);
        setCells(monthCells);
        setStaff([]);
        return;
      }
      const [monthCells, staffList, wh] = await Promise.all([
        mode === 'super'
          ? api.saRosterMonth(token, year, month, track)
          : api.adminRosterMonth(token, year, month, track),
        mode === 'super'
          ? api.saRosterStaff(token, track)
          : api.adminRosterStaff(token, track),
        mode === 'super'
          ? api.saRosterWorkingHours(token)
          : api.adminRosterWorkingHours(token),
      ]);
      setCells(monthCells);
      setStaff(staffList);
      setHours({ ...DEFAULT_CLUB_WORKING_HOURS, ...wh });

      if (showMotivation) {
        const from = `${year}-${pad(month)}-01`;
        const last = new Date(year, month, 0).getDate();
        const to = `${year}-${pad(month)}-${pad(last)}`;
        if (mode === 'super') {
          setSummary(await api.saRosterSummaries(token, from, to, track));
        } else {
          setSummary(await api.adminRosterMyHours(token, from, to));
        }
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка загрузки');
    }
  }, [mode, year, month, track, showMotivation]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setUserId('');
  }, [track]);

  useEffect(() => {
    if (staff[0] && !staff.some((s) => s.id === userId)) {
      setUserId(staff[0].id);
    }
  }, [staff, userId]);

  const shiftByDate = useMemo(() => {
    const m = new Map<string, StaffShiftDto[]>();
    for (const c of cells) m.set(c.date, c.shifts);
    return m;
  }, [cells]);

  const daysInMonth = new Date(year, month, 0).getDate();

  const clubDayHint = (dateStr: string) => {
    const d = new Date(`${dateStr}T12:00:00`);
    const day = hours[dayKeyFromDate(d)];
    if (!day || day.closed) return 'закрыто';
    return `${day.open}–${day.close}`;
  };

  const prevMonth = () => {
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else setMonth((m) => m + 1);
  };

  const openDay = (date: string) => {
    setSelectedDate(date);
    setEditShift(null);
    const hint = clubDayHint(date);
    if (hint !== 'закрыто' && hint.includes('–')) {
      const [o, c] = hint.split('–');
      setStartTime(o!);
      setEndTime(c!);
    }
    setNote('');
  };

  const saveShift = async () => {
    if (!canEdit || !selectedDate || !userId) return;
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setMessage('');
    try {
      const body = {
        id: editShift?.id,
        userId,
        track,
        date: selectedDate,
        startAt: new Date(`${selectedDate}T${startTime}:00`).toISOString(),
        endAt: new Date(`${selectedDate}T${endTime}:00`).toISOString(),
        note: note || undefined,
      };
      if (mode === 'super') await api.saRosterUpsertShift(token, body);
      else await api.adminRosterUpsertShift(token, body);
      await load();
      setEditShift(null);
      setMessage('Смена сохранена');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const removeShift = async (id: string) => {
    if (!canEdit) return;
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      if (mode === 'super') await api.saRosterDeleteShift(token, id);
      else await api.adminRosterDeleteShift(token, id);
      await load();
      setEditShift(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (s: StaffShiftDto) => {
    setSelectedDate(s.date);
    setEditShift(s);
    setUserId(s.userId);
    setStartTime(timeOf(s.startAt));
    setEndTime(timeOf(s.endAt));
    setNote(s.note ?? '');
  };

  const summaries = Array.isArray(summary) ? summary : summary ? [summary] : [];

  return (
    <div className="space-y-5 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">График смен</h1>
          <p className="text-sm text-slate-400">
            {mode === 'trainer'
              ? 'Ваши смены из журнала админа. Открыть запись клиентов — в Расписании.'
              : 'Распределение рабочего времени клуба. Правки пересчитывают часы и мотивацию.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary px-3 py-1.5" onClick={prevMonth}>
            ←
          </button>
          <span className="min-w-[10rem] text-center capitalize text-white">
            {monthLabel(year, month)}
          </span>
          <button type="button" className="btn-secondary px-3 py-1.5" onClick={nextMonth}>
            →
          </button>
        </div>
      </header>

      {mode !== 'trainer' && (
        <div className="flex flex-wrap gap-2">
          {TRACKS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTrack(t.id)}
              className={
                track === t.id
                  ? 'btn-primary px-4 py-2 text-sm'
                  : 'btn-secondary px-4 py-2 text-sm'
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {message && (
        <p className="text-sm text-amber-300">{message}</p>
      )}

      <div className="overflow-x-auto rounded-xl border border-white/10 bg-slate-900/40 p-3">
        <div className="mb-2 grid grid-cols-7 gap-1 text-center text-xs uppercase tracking-wide text-slate-500">
          {DAY_OF_WEEK_KEYS.map((k) => (
            <div key={k}>{DAY_LABELS[k]}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstWeekday }).map((_, i) => (
            <div key={`pad-${i}`} className="min-h-[5.5rem]" />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const date = `${year}-${pad(month)}-${pad(day)}`;
            const shifts = shiftByDate.get(date) ?? [];
            const closed = clubDayHint(date) === 'закрыто';
            const selected = selectedDate === date;
            return (
              <button
                key={date}
                type="button"
                onClick={() => openDay(date)}
                className={`min-h-[5.5rem] rounded-lg border p-1.5 text-left transition ${
                  selected
                    ? 'border-emerald-400/60 bg-emerald-500/10'
                    : closed
                      ? 'border-white/5 bg-slate-950/40 opacity-60'
                      : 'border-white/10 bg-slate-950/30 hover:border-white/25'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">{day}</span>
                  <span className="text-[10px] text-slate-500">
                    {clubDayHint(date)}
                  </span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {shifts.slice(0, 3).map((s) => (
                    <div
                      key={s.id}
                      className="truncate rounded bg-white/10 px-1 py-0.5 text-[10px] text-slate-200"
                      title={`${s.userName} ${timeOf(s.startAt)}–${timeOf(s.endAt)}`}
                    >
                      {s.userName.split(' ')[0]} {timeOf(s.startAt)}
                    </div>
                  ))}
                  {shifts.length > 3 && (
                    <div className="text-[10px] text-slate-500">
                      +{shifts.length - 3}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {selectedDate && (
        <div className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-medium text-white">
              {selectedDate}
              <span className="ml-2 text-sm font-normal text-slate-400">
                клуб: {clubDayHint(selectedDate)}
              </span>
            </h2>
            <button
              type="button"
              className="text-sm text-slate-400 hover:text-white"
              onClick={() => setSelectedDate(null)}
            >
              Закрыть
            </button>
          </div>

          <ul className="space-y-2">
            {(shiftByDate.get(selectedDate) ?? []).map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 px-3 py-2"
              >
                <div>
                  <p className="text-sm text-white">{s.userName}</p>
                  <p className="text-xs text-slate-400">
                    {timeOf(s.startAt)}–{timeOf(s.endAt)} ·{' '}
                    {(s.minutes / 60).toFixed(1)} ч
                    {s.note ? ` · ${s.note}` : ''}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-secondary px-2 py-1 text-xs"
                      onClick={() => startEdit(s)}
                    >
                      Изменить
                    </button>
                    <button
                      type="button"
                      className="btn-secondary px-2 py-1 text-xs text-red-300"
                      onClick={() => removeShift(s.id)}
                      disabled={busy}
                    >
                      Удалить
                    </button>
                  </div>
                )}
              </li>
            ))}
            {(shiftByDate.get(selectedDate) ?? []).length === 0 && (
              <p className="text-sm text-slate-500">Смен нет</p>
            )}
          </ul>

          {canEdit && (
            <div className="grid gap-3 border-t border-white/10 pt-3 sm:grid-cols-2">
              <label className="block text-xs text-slate-400">
                Сотрудник
                <select
                  className="input mt-1 w-full"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                >
                  <option value="">—</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-slate-400">
                Заметка
                <input
                  className="input mt-1 w-full"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <label className="block text-xs text-slate-400">
                Начало
                <input
                  type="time"
                  className="input mt-1 w-full"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </label>
              <label className="block text-xs text-slate-400">
                Конец
                <input
                  type="time"
                  className="input mt-1 w-full"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn-primary sm:col-span-2"
                disabled={busy || !userId}
                onClick={saveShift}
              >
                {editShift ? 'Сохранить изменения' : 'Добавить смену'}
              </button>
            </div>
          )}
        </div>
      )}

      {showMotivation && summaries.length > 0 && (
        <div className="card space-y-3">
          <h2 className="text-lg font-medium text-white">
            {mode === 'super' ? 'Мотивация по сменам' : 'Моя мотивация'}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Сотрудник</th>
                  <th className="py-2 pr-3">Смен</th>
                  <th className="py-2 pr-3">Часы</th>
                  <th className="py-2 pr-3">Ставка</th>
                  <th className="py-2">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((s) => (
                  <tr key={s.userId} className="border-t border-white/5">
                    <td className="py-2 pr-3 text-white">{s.userName}</td>
                    <td className="py-2 pr-3 text-slate-300">{s.shiftCount}</td>
                    <td className="py-2 pr-3 text-slate-300">
                      {(s.totalMinutes / 60).toFixed(1)}
                    </td>
                    <td className="py-2 pr-3 text-slate-300">
                      {money(s.hourlyRateMinor, s.currency)}/ч
                    </td>
                    <td className="py-2 font-medium text-emerald-300">
                      {money(s.payMinor, s.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
