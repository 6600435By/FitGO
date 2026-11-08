'use client';

import { Button, ResponsiveSheet, SegmentedControl } from '@fitgo/forma-ui';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

type ClientOpt = {
  id: string;
  firstName: string;
  lastName: string;
};

type SessionOpt = {
  id: string;
  startAt: string;
  label: string;
};

type Mode = 'note' | 'measurement';

export function NoteMeasurementSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [clientId, setClientId] = useState('');
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<Mode>('note');
  const [content, setContent] = useState('');
  const [weight, setWeight] = useState('');
  const [sessions, setSessions] = useState<SessionOpt[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    if (!open) return;
    const token = getToken();
    if (!token) return;
    setError('');
    setDone('');
    void api
      .trainerClients(token)
      .then((list) =>
        setClients(
          list.map((c) => ({
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
          })),
        ),
      )
      .catch(() => setClients([]));
  }, [open]);

  useEffect(() => {
    if (!open || !clientId) {
      setSessions([]);
      setSessionId('');
      return;
    }
    const token = getToken();
    if (!token) return;
    void api
      .trainerClientProgress(token, clientId)
      .then((progress) => {
        const upcoming = (progress.recentSessions ?? [])
          .filter((s) => s.status === 'CONFIRMED' || s.status === 'COMPLETED')
          .slice(0, 8)
          .map((s) => ({
            id: s.id,
            startAt: s.startAt,
            label: format(new Date(s.startAt), 'd MMM HH:mm', { locale: ru }),
          }));
        setSessions(upcoming);
        setSessionId('');
      })
      .catch(() => {
        setSessions([]);
        setSessionId('');
      });
  }, [open, clientId]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter((c) =>
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(needle),
    );
  }, [clients, q]);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  );

  const save = async () => {
    const token = getToken();
    if (!token || !clientId) {
      setError('Выберите клиента');
      return;
    }
    setBusy(true);
    setError('');
    setDone('');
    try {
      if (mode === 'note') {
        const text = content.trim();
        if (!text) {
          setError('Введите текст заметки');
          setBusy(false);
          return;
        }
        await api.trainerAddNote(token, clientId, text);
        if (sessionId) {
          const detail = await api.personalSessionDetail(token, sessionId);
          const sheet = {
            ...(detail.workoutSheet ?? {}),
            trainerPrivateNotes: [
              detail.workoutSheet?.trainerPrivateNotes,
              text,
            ]
              .filter(Boolean)
              .join('\n\n'),
          };
          await api.personalSessionUpdatePlan(token, sessionId, {
            goals: detail.goals.map((g) => ({
              id: g.id,
              title: g.title,
              notes: g.notes,
              tasks: g.tasks.map((t) => ({ id: t.id, title: t.title })),
            })),
            workoutSheet: sheet as import('@fitgo/shared-types').WorkoutSheet,
          });
        }
        setDone(
          sessionId
            ? 'Заметка сохранена у клиента и в тренировке'
            : 'Заметка сохранена у клиента',
        );
        setContent('');
      } else {
        const w = weight.trim() ? Number(weight.replace(',', '.')) : undefined;
        if (w == null || !Number.isFinite(w)) {
          setError('Укажите вес');
          setBusy(false);
          return;
        }
        await api.trainerAddMeasurement(token, clientId, {
          weight: w,
          notes: content.trim() || undefined,
        });
        setDone('Замер сохранён');
        setWeight('');
        setContent('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Заметка или замер"
      description="Не обязательно привязывать к тренировке"
      desktop="dialog"
    >
      <div className="space-y-4 pb-2">
        <SegmentedControl<Mode>
          size="sm"
          layoutId="note-meas-mode"
          className="w-full"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'note', label: 'Заметка' },
            { value: 'measurement', label: 'Замер' },
          ]}
        />

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Клиент
          </p>
          <input
            className="input w-full"
            placeholder="Поиск…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
            enterKeyHint="search"
          />
          {selectedClient ? (
            <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-ink-raised/60 px-3 py-2">
              <p className="text-sm text-white">
                {selectedClient.firstName} {selectedClient.lastName}
              </p>
              <button
                type="button"
                className="shrink-0 text-xs text-zinc-400 hover:text-white"
                onClick={() => setClientId('')}
              >
                Сменить
              </button>
            </div>
          ) : null}
          {(!clientId || q.trim()) && (
            <div className="max-h-36 space-y-1 overflow-y-auto overscroll-contain">
              {filtered.slice(0, 12).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`flex w-full rounded-2xl border px-3 py-2 text-left text-sm ${
                    clientId === c.id
                      ? 'border-forma-500/50 bg-forma-500/10 text-white'
                      : 'border-white/10 text-zinc-300'
                  }`}
                  onClick={() => {
                    setClientId(c.id);
                    setQ('');
                  }}
                >
                  {c.firstName} {c.lastName}
                </button>
              ))}
            </div>
          )}
        </div>

        {clientId && sessions.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Тренировка
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`rounded-full px-3 py-1 text-xs ${
                  !sessionId
                    ? 'bg-forma-500 text-ink'
                    : 'border border-white/10 text-zinc-300'
                }`}
                onClick={() => setSessionId('')}
              >
                Без тренировки
              </button>
              {sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`rounded-full px-3 py-1 text-xs ${
                    sessionId === s.id
                      ? 'bg-forma-500 text-ink'
                      : 'border border-white/10 text-zinc-300'
                  }`}
                  onClick={() => setSessionId(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {mode === 'measurement' ? (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Вес (кг)
            </p>
            <input
              className="input w-full"
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="например 72.5"
            />
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {mode === 'note' ? 'Текст' : 'Комментарий'}
          </p>
          <textarea
            className="input min-h-[96px] w-full"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              mode === 'note' ? 'Заметка для себя…' : 'Необязательно'
            }
          />
        </div>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        {done ? <p className="text-sm text-forma-400">{done}</p> : null}

        <Button
          type="button"
          className="w-full"
          disabled={busy || !clientId}
          loading={busy}
          onClick={() => void save()}
        >
          Сохранить
        </Button>
        {clientId ? (
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              onOpenChange(false);
              window.location.href = `/trainer/clients/${encodeURIComponent(clientId)}`;
            }}
          >
            Открыть карточку клиента
          </Button>
        ) : null}
      </div>
    </ResponsiveSheet>
  );
}
