'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type GroupClassSessionDto } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
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
  const [active, setActive] = useState<GroupClassSessionDto | null>(null);
  const [newName, setNewName] = useState('');
  const [message, setMessage] = useState('');
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
        startAt: openForm.startAt,
        endAt: openForm.endAt,
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

  const addMember = async () => {
    const token = getToken();
    if (!token || !active || !newName.trim()) return;
    const s = await api.trainerAddGroupMember(token, active.id, {
      displayName: newName.trim(),
    });
    setActive(s);
    setNewName('');
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
        Эталон из записи → отметьте кто был → Сдать. Цвет = доверие к составу.
      </p>
      {message && <p className="text-sm text-amber-300">{message}</p>}

      <div className="flex flex-wrap gap-2 items-end">
        <label className="text-sm">
          С
          <input
            type="date"
            className="input ml-1"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-sm">
          По
          <input
            type="date"
            className="input ml-1"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button type="button" className="btn-secondary" onClick={load}>
          Обновить
        </button>
      </div>

      <div className="rounded border border-slate-800 p-3 space-y-2 text-sm">
        <p className="font-medium">Открыть журнал по id занятия 1С</p>
        <div className="flex flex-wrap gap-2">
          <input
            className="input"
            placeholder="appointmentId"
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
          <button type="button" className="btn-primary" onClick={createOpen}>
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
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="Добавить (имя) — будет с флагом"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button type="button" className="btn-secondary" onClick={addMember}>
              +
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
