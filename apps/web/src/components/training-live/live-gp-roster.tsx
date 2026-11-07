'use client';

import { ResponsiveSheet } from '@fitgo/forma-ui';
import { Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, type GroupClassSessionDto } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { cn } from '@/lib/utils';

export function LiveGpRoster({
  sessionKey,
  title,
}: {
  sessionKey: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [journal, setJournal] = useState<GroupClassSessionDto | null>(null);
  const [note, setNote] = useState('');
  const [groupRpe, setGroupRpe] = useState(6);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const loadNote = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const row = await api.trainerGetGroupNote(token, sessionKey);
      if (row) {
        setNote(row.text ?? '');
        if (row.groupRpe) setGroupRpe(row.groupRpe);
      }
    } catch {
      /* ignore */
    }
  }, [sessionKey]);

  const ensureJournal = useCallback(async () => {
    const token = getToken();
    if (!token) return null;
    const day = new Date().toISOString().slice(0, 10);
    const list = await api.trainerGroupSessions(token, day, day);
    const hit =
      list.find(
        (s) =>
          s.appointmentId === sessionKey ||
          s.id === sessionKey ||
          sessionKey.includes(s.appointmentId),
      ) ?? null;
    if (hit) {
      const full = await api.trainerGetGroupSession(token, hit.id);
      setJournal(full);
      return full;
    }
    return null;
  }, [sessionKey]);

  useEffect(() => {
    if (!open) return;
    ensureJournal().catch(() => setMessage('Журнал ещё не открыт'));
  }, [open, ensureJournal]);

  useEffect(() => {
    loadNote().catch(() => undefined);
  }, [loadNote]);

  const setAttendance = async (
    memberId: string,
    attendance: 'ATTENDED' | 'NO_SHOW' | 'EXPECTED',
  ) => {
    if (!journal) return;
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      const next = await api.trainerSetGroupMemberAttendance(
        token,
        journal.id,
        memberId,
        attendance,
      );
      setJournal(next);
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      await api.trainerUpsertGroupNote(token, {
        sessionKey,
        text: note,
        groupRpe,
      });
      setNoteOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-center gap-2 px-4 pb-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-200"
        >
          <Users className="h-4 w-4 text-cyan-400" />
          Состав
          {journal ? ` · ${journal.members.length}` : ''}
        </button>
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-200"
        >
          Заметка группы
        </button>
      </div>

      <ResponsiveSheet
        open={open}
        onOpenChange={setOpen}
        title={title || 'Состав группы'}
        description="Быстрая отметка присутствия"
        desktop="dialog"
      >
        <div className="space-y-2 pb-4">
          {message ? (
            <p className="text-sm text-amber-400/90">{message}</p>
          ) : null}
          {!journal ? (
            <p className="text-sm text-zinc-500">
              Откройте журнал групп на это занятие — здесь появится список.
            </p>
          ) : (
            journal.members.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">
                    {m.displayName}
                  </p>
                  <p className="text-[11px] text-zinc-500">{m.attendance}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void setAttendance(m.id, 'ATTENDED')}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[11px]',
                      m.attendance === 'ATTENDED'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-white/5 text-zinc-400',
                    )}
                  >
                    Был
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void setAttendance(m.id, 'NO_SHOW')}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[11px]',
                      m.attendance === 'NO_SHOW'
                        ? 'bg-red-500/20 text-red-300'
                        : 'bg-white/5 text-zinc-400',
                    )}
                  >
                    Неявка
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </ResponsiveSheet>

      <ResponsiveSheet
        open={noteOpen}
        onOpenChange={setNoteOpen}
        title="Заметка к занятию"
        description="Только для вас — клиентам не уходит"
        desktop="dialog"
      >
        <div className="space-y-4 pb-4">
          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-zinc-400">RPE группы</span>
              <span className="font-display text-lg text-forma-400">
                {groupRpe}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              value={groupRpe}
              onChange={(e) => setGroupRpe(Number(e.target.value))}
              className="w-full accent-[#ffd000]"
            />
          </div>
          <textarea
            className="input min-h-[120px] w-full py-3 text-sm"
            placeholder="Как прошло занятие…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveNote()}
            className="btn-primary w-full disabled:opacity-50"
          >
            Сохранить
          </button>
        </div>
      </ResponsiveSheet>
    </>
  );
}
