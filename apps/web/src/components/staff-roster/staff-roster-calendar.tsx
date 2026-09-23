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
  clubHoursForDate,
  rosterDayKind,
  trackDayCapMinutes,
} from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { StaffDayDialog } from './staff-day-dialog';

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
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [dayOpen, setDayOpen] = useState('07:00');
  const [dayClose, setDayClose] = useState('23:00');
  const [dayClosed, setDayClosed] = useState(false);

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

  const shiftByDate = useMemo(() => {
    const m = new Map<string, StaffShiftDto[]>();
    for (const c of cells) m.set(c.date, c.shifts);
    return m;
  }, [cells]);

  const daysInMonth = new Date(year, month, 0).getDate();

  const clubDayHint = (dateStr: string) => {
    const d = new Date(`${dateStr}T12:00:00`);
    const day = clubHoursForDate(hours, d);
    if (!day || day.closed) return 'закрыто';
    const kind = rosterDayKind(d, hours.holidayDates ?? []);
    const tag = kind === 'weekend' ? 'вых' : 'буд';
    return `${day.open}–${day.close} ${tag}`;
  };

  const dayBudget = (dateStr: string) => {
    const d = new Date(`${dateStr}T12:00:00`);
    const kind = rosterDayKind(d, hours.holidayDates ?? []);
    const cap = trackDayCapMinutes(track, d, hours.holidayDates ?? []);
    const used = (shiftByDate.get(dateStr) ?? []).reduce(
      (sum, s) => sum + s.minutes,
      0,
    );
    return {
      kind,
      cap,
      used,
      holiday: (hours.holidayDates ?? []).includes(dateStr),
      custom: Boolean(hours.dayOverrides?.[dateStr]),
    };
  };

  useEffect(() => {
    if (!selectedDate) return;
    const day = clubHoursForDate(hours, new Date(`${selectedDate}T12:00:00`));
    setDayOpen(day?.open ?? '07:00');
    setDayClose(day?.close ?? '23:00');
    setDayClosed(!!day?.closed);
  }, [selectedDate, hours]);

  const patchDay = async (body: {
    date: string;
    holiday?: boolean;
    hours?: { open: string; close: string; closed?: boolean } | null;
  }) => {
    const token = getToken();
    if (!token || !canEdit) return;
    setBusy(true);
    setMessage('');
    try {
      const next =
        mode === 'super'
          ? await api.saRosterPatchDay(token, body)
          : await api.adminRosterPatchDay(token, body);
      setHours({ ...DEFAULT_CLUB_WORKING_HOURS, ...next });
      setMessage('День обновлён');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
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

  const removeShift = async (id: string) => {
    if (!canEdit) return;
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      if (mode === 'super') await api.saRosterDeleteShift(token, id);
      else await api.adminRosterDeleteShift(token, id);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const savePerson = async (input: {
    id?: string;
    userId: string;
    start: string;
    end: string;
    overtimeMinutes?: number;
  }) => {
    if (!canEdit || !selectedDate) return false;
    const token = getToken();
    if (!token) return false;
    setBusy(true);
    setMessage('');
    try {
      const body = {
        id: input.id,
        userId: input.userId,
        userIds: input.id ? undefined : [input.userId],
        track,
        date: selectedDate,
        startAt: new Date(`${selectedDate}T${input.start}:00`).toISOString(),
        endAt: new Date(`${selectedDate}T${input.end}:00`).toISOString(),
        overtimeMinutes: input.overtimeMinutes,
      };
      if (mode === 'super') await api.saRosterUpsertShift(token, body);
      else await api.adminRosterUpsertShift(token, body);
      await load();
      return true;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const fillPerson = async (input: {
    userId: string;
    start: string;
    end: string;
    dates: string[];
    overtimeMinutes?: number;
  }) => {
    if (!canEdit) return false;
    const token = getToken();
    if (!token) return false;
    setBusy(true);
    setMessage('');
    try {
      const body = {
        userId: input.userId,
        track,
        startTime: input.start,
        endTime: input.end,
        dates: input.dates,
        overtimeMinutes: input.overtimeMinutes,
        skipIfExists: true,
      };
      const result =
        mode === 'super'
          ? await api.saRosterFillShifts(token, body)
          : await api.adminRosterFillShifts(token, body);
      await load();
      const skipHint =
        result.skipped.length > 0
          ? ` Пропущено: ${result.skipped.length} (${result.skipped
              .slice(0, 3)
              .map((s) => s.date)
              .join(', ')}${result.skipped.length > 3 ? '…' : ''})`
          : '';
      setMessage(`Создано смен: ${result.created}.${skipHint}`);
      return true;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const suggestWindow = (date: string) => {
    const d = new Date(`${date}T12:00:00`);
    const day = clubHoursForDate(hours, d);
    const open = day?.open ?? '07:00';
    const close = day?.close ?? '23:00';
    const weekend = rosterDayKind(d, hours.holidayDates ?? []) === 'weekend';
    const used = (shiftByDate.get(date) ?? []).reduce((sum, s) => sum + s.minutes, 0);
    const cap = trackDayCapMinutes(track, d, hours.holidayDates ?? []);
    const remain = Math.max(0, cap - used);
    const pair: [string, string] =
      used === 0
        ? weekend
          ? ['09:00', '21:00']
          : ['07:00', '20:00']
        : weekend
          ? ['15:00', '21:00']
          : ['12:00', '23:00'];
    let start = pair[0] < open ? open : pair[0];
    let end = pair[1] > close ? close : pair[1];
    const span = (() => {
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      return eh! * 60 + em! - (sh! * 60 + sm!);
    })();
    if (remain > 0 && span > remain) {
      const [ch, cm] = close.split(':').map(Number);
      let total = ch! * 60 + cm! - remain;
      if (total < 0) total = 0;
      start = `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
      if (start < open) start = open;
      end = close;
    }
    return { start, end, used, cap };
  };

  const summaries = Array.isArray(summary) ? summary : summary ? [summary] : [];

  return (
    <div className="space-y-5 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">График смен</h1>
          <p className="text-sm text-slate-400">
            {mode === 'trainer'
              ? 'Дежурство ставит администратор. Здесь его можно только смотреть. Время до или после дежурства открывается в Расписании: клиенты записываются, но ставка за эти часы не начисляется.'
              : track === 'TRAINER'
                ? 'Дежурство: в эти часы клиенты могут записаться, и часы идут в ставку. Время до и после тренер открывает сам.'
              : 'Двойной щелчок по дню — добавить или изменить. Можно скопировать смену на период или выбранные дни недели.'}
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
                onDoubleClick={(e) => {
                  e.preventDefault();
                  setSelectedDate(date);
                  setMessage('');
                }}
                title="Двойной щелчок — кто работает"
                className={`min-h-[7.5rem] rounded-lg border p-1.5 text-left align-top transition ${
                  selected
                    ? 'border-emerald-400/60 bg-emerald-500/10'
                    : closed
                      ? 'border-white/5 bg-slate-950/40 opacity-60'
                      : 'border-white/10 bg-slate-950/30 hover:border-white/25'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-sm font-medium text-white">{day}</span>
                  <span className="text-[10px] text-slate-500">
                    {shifts.length > 0
                      ? shifts.length
                      : (hours.holidayDates ?? []).includes(date)
                        ? 'праздник'
                        : ''}
                  </span>
                </div>
                <div className="mt-1 max-h-28 space-y-0.5 overflow-y-auto">
                  {shifts.map((s) => (
                    <div
                      key={s.id}
                      className="rounded bg-emerald-500/15 px-1 py-0.5 text-[10px] leading-tight text-slate-100"
                      title={`${s.userName} ${timeOf(s.startAt)}–${timeOf(s.endAt)}`}
                    >
                      <span className="block truncate font-medium">
                        {s.userName.split(' ')[0]}
                      </span>
                      <span className="block text-emerald-200/90">
                        {timeOf(s.startAt)}–{timeOf(s.endAt)}
                        {s.overtimeMinutes > 0 ? ` +${s.overtimeMinutes}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {selectedDate && (() => {
        const win = suggestWindow(selectedDate);
        const budget = dayBudget(selectedDate);
        return (
          <StaffDayDialog
            date={selectedDate}
            shifts={shiftByDate.get(selectedDate) ?? []}
            staff={staff}
            canEdit={canEdit}
            busy={busy}
            message={message}
            usedMinutes={win.used}
            capMinutes={win.cap}
            intro={
              track === 'TRAINER'
                ? 'Дежурство. Эти часы оплачиваются по ставке, клиенты могут записаться. Время до и после тренер ставит сам.'
                : undefined
            }
            defaultStart={win.start}
            defaultEnd={win.end}
            allowOvertime={track === 'ADMIN'}
            holiday={budget.holiday}
            customHours={budget.custom}
            dayOpen={dayOpen}
            dayClose={dayClose}
            dayClosed={dayClosed}
            onDayOpen={setDayOpen}
            onDayClose={setDayClose}
            onDayClosed={setDayClosed}
            onPatchDay={(body) => patchDay({ date: selectedDate, ...body })}
            onClose={() => setSelectedDate(null)}
            onSave={savePerson}
            onFill={fillPerson}
            onDelete={removeShift}
          />
        );
      })()}

      {showMotivation && summaries.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer text-sm font-medium text-white">
            {mode === 'super' ? 'Суммы по сменам' : 'Мои часы и сумма'}
          </summary>
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
        </details>
      )}
    </div>
  );
}
