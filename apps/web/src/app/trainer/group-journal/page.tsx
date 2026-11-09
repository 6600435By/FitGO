'use client';

import type { GpScheduleEvent } from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateField } from '@/components/ui/date-field';
import { api, type GroupClassSessionDto } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function toDatetimeLocal(iso: string) {
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function bandClass(band: string) {
  if (band === 'GREEN') return 'border-emerald-700/50 bg-emerald-950/30';
  if (band === 'RED') return 'border-red-700/50 bg-red-950/20';
  return 'border-amber-700/50 bg-amber-950/20';
}

export default function TrainerGroupJournalPage() {
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - 7);
    return isoDate(d);
  });
  const [to, setTo] = useState(isoDate(today));
  const [sessions, setSessions] = useState<GroupClassSessionDto[]>([]);
  const [todayClasses, setTodayClasses] = useState<GpScheduleEvent[]>([]);
  const [active, setActive] = useState<GroupClassSessionDto | null>(null);
  const [message, setMessage] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [openForm, setOpenForm] = useState({
    appointmentId: '',
    title: '',
    startAt: '',
    endAt: '',
    roomTitle: '',
  });

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;
    api
      .trainerGroupSessions(token, from, to)
      .then(setSessions)
      .catch((e) => setMessage(e.message || 'Ошибка'));
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const day = isoDate(new Date());
    api
      .trainerGpSchedule(token, day, day)
      .then((list) => {
        setTodayClasses(list);
        if (list[0] && !selectedClassId) {
          setSelectedClassId(list[0].id);
          setOpenForm({
            appointmentId: list[0].onexExternalId || list[0].id,
            title: list[0].title,
            startAt: toDatetimeLocal(list[0].startAt),
            endAt: toDatetimeLocal(list[0].endAt),
            roomTitle: list[0].roomTitle ?? '',
          });
        }
      })
      .catch(() => setTodayClasses([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once from today's GP
  }, []);

  const pickClass = (id: string) => {
    setSelectedClassId(id);
    const cls = todayClasses.find((c) => c.id === id);
    if (!cls) return;
    setOpenForm({
      appointmentId: cls.onexExternalId || cls.id,
      title: cls.title,
      startAt: toDatetimeLocal(cls.startAt),
      endAt: toDatetimeLocal(cls.endAt),
      roomTitle: cls.roomTitle ?? '',
    });
  };

  const openExisting = async (id: string) => {
    const token = getToken();
    if (!token) return;
    const s = await api.trainerGetGroupSession(token, id);
    setActive(s);
  };

  const createOpen = async () => {
    const token = getToken();
    if (!token) return;
    try {
      const s = await api.trainerOpenGroupSession(token, {
        appointmentId: openForm.appointmentId.trim(),
        title: openForm.title.trim() || 'Групповое занятие',
        startAt: new Date(openForm.startAt).toISOString(),
        endAt: new Date(openForm.endAt).toISOString(),
        roomTitle: openForm.roomTitle.trim() || undefined,
      });
      setActive(s);
      load();
      setMessage('');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const toggleAttended = async (memberId: string, current: string) => {
    const token = getToken();
    if (!token || !active) return;
    const next = current === 'ATTENDED' ? 'NO_SHOW' : 'ATTENDED';
    const s = await api.trainerSetGroupMemberAttendance(
      token,
      active.id,
      memberId,
      next,
    );
    setActive(s);
  };

  const submit = async () => {
    const token = getToken();
    if (!token || !active) return;
    try {
      const s = await api.trainerSubmitGroupSession(token, active.id);
      setActive(s);
      load();
      setMessage(
        s.status === 'AUTO_READY'
          ? 'Сдано — зелёный путь, админ не нужен'
          : 'Сдано — есть нестыковки, разберёт админ',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка сдачи');
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Журнал групп</h1>
      <p className="text-sm text-slate-400">
        Состав из 1С / записи клиентов. Отметьте присутствие → Сдать. Добавлять
        клиентов в группу тренер не может. Для ЗП подтвердите занятие в «Мои
        занятия» (контроль записей).
      </p>
      {message && <p className="text-sm text-amber-300">{message}</p>}

      <div className="flex flex-wrap items-end gap-3">
        <DateField label="С" value={from} onChange={setFrom} />
        <DateField label="По" value={to} onChange={setTo} />
        <button type="button" className="btn-secondary" onClick={load}>
          Обновить
        </button>
      </div>

      <div className="rounded border border-slate-800 p-3 space-y-2 text-sm">
        <p className="font-medium">Открыть журнал по занятию</p>
        {todayClasses.length > 0 ? (
          <select
            className="input w-full"
            value={selectedClassId}
            onChange={(e) => pickClass(e.target.value)}
          >
            {todayClasses.map((c) => (
              <option key={c.id} value={c.id}>
                {formatDateTime(c.startAt)} · {c.title}
                {c.roomTitle ? ` · ${c.roomTitle}` : ''}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-slate-500">
            На сегодня занятий нет — можно ввести id вручную.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            className="input"
            placeholder="appointmentId (если нет в списке)"
            value={openForm.appointmentId}
            onChange={(e) =>
              setOpenForm((f) => ({ ...f, appointmentId: e.target.value }))
            }
          />
          <input
            className="input"
            placeholder="Название"
            value={openForm.title}
            onChange={(e) =>
              setOpenForm((f) => ({ ...f, title: e.target.value }))
            }
          />
          <input
            type="datetime-local"
            className="input"
            value={openForm.startAt}
            onChange={(e) =>
              setOpenForm((f) => ({ ...f, startAt: e.target.value }))
            }
          />
          <input
            type="datetime-local"
            className="input"
            value={openForm.endAt}
            onChange={(e) =>
              setOpenForm((f) => ({ ...f, endAt: e.target.value }))
            }
          />
          <input
            className="input"
            placeholder="Зал (из 1С)"
            value={openForm.roomTitle}
            onChange={(e) =>
              setOpenForm((f) => ({ ...f, roomTitle: e.target.value }))
            }
          />
          <button
            type="button"
            className="btn-primary"
            onClick={createOpen}
            disabled={!openForm.appointmentId || !openForm.startAt}
          >
            Открыть
          </button>
        </div>
      </div>

      <ul className="space-y-2">
        {sessions.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className={`w-full text-left rounded border p-3 ${bandClass(s.trustBand)}`}
              onClick={() => openExisting(s.id)}
            >
              <span className="font-medium">{s.title}</span>
              <span className="text-sm text-slate-400 ml-2">
                {formatDateTime(s.startAt)} · {s.status} · {s.trustBand}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {active && (
        <div className={`rounded border p-4 space-y-3 ${bandClass(active.trustBand)}`}>
          <div className="flex flex-wrap justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">{active.title}</h2>
              <p className="text-sm text-slate-400">
                {formatDateTime(active.startAt)} · эталон {active.baselineCount}{' '}
                · {active.status} · {active.trustBand}
              </p>
              {active.trustReasonLabels.length > 0 && (
                <p className="text-xs text-amber-300">
                  {active.trustReasonLabels.join(' · ')}
                </p>
              )}
            </div>
            <button type="button" className="btn-primary" onClick={submit}>
              Сдать журнал
            </button>
          </div>
          <ul className="space-y-1">
            {active.members.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm py-1 border-b border-slate-900"
              >
                <span>
                  {m.displayName}{' '}
                  <span className="text-xs text-slate-500">
                    {m.source} · {m.trustBand}
                    {m.visitMatched ? ' · вход✓' : ' · вход✗'}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => toggleAttended(m.id, m.attendance)}
                >
                  {m.attendance === 'ATTENDED' ? 'Был' : m.attendance}
                </button>
              </li>
            ))}
          </ul>
          {active.members.length === 0 && (
            <p className="text-sm text-slate-500">
              В эталоне никого нет — состав подтянется из 1С при открытии журнала.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
