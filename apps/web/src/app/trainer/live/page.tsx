'use client';

import { Button, ResponsiveSheet } from '@fitgo/forma-ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { liveHrefForSession } from '@/components/training-live/live-href';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

type ClientOpt = {
  id: string;
  firstName: string;
  lastName: string;
};

/** Resolves nearest PT/GP, or offers quick-start when the day is empty. */
export default function TrainerLiveEntryPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [emptyDay, setEmptyDay] = useState(false);
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    let cancelled = false;
    api
      .trainerGpHome(token)
      .then((home) => {
        if (cancelled) return;
        const next = home.today.next;
        if (!next) {
          setEmptyDay(true);
          void api
            .trainerClients(token)
            .then((list) => {
              if (!cancelled) {
                setClients(
                  list.map((c) => ({
                    id: c.id,
                    firstName: c.firstName,
                    lastName: c.lastName,
                  })),
                );
              }
            })
            .catch(() => undefined);
          return;
        }
        const href = liveHrefForSession(next);
        if (!href) {
          setError('Не удалось открыть режим тренировки');
          return;
        }
        const params = new URLSearchParams();
        if (next.title) params.set('title', next.title);
        if (next.clientId) params.set('clientId', next.clientId);
        const qs = params.toString();
        router.replace(`${href}${qs ? `?${qs}` : ''}`);
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить расписание');
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const startWithClient = async (client: ClientOpt) => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const booking = await api.trainerAssignPersonalBooking(token, {
        clientId: client.id,
        startAt: new Date().toISOString(),
      });
      const title = `${client.firstName} ${client.lastName}`.trim();
      router.replace(
        `/trainer/live/pt/${encodeURIComponent(booking.id)}?title=${encodeURIComponent(title)}&clientId=${encodeURIComponent(client.id)}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать запись');
      setBusy(false);
    }
  };

  const filtered = clients.filter((c) => {
    const hay = `${c.firstName} ${c.lastName}`.toLowerCase();
    return !q.trim() || hay.includes(q.trim().toLowerCase());
  });

  if (emptyDay) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[#070708] px-6 text-center">
        <p className="font-display text-xl font-semibold text-white">
          Быстрый старт
        </p>
        <p className="mt-2 max-w-sm text-sm text-zinc-500">
          На сегодня нет ближайшей записи. Можно начать сейчас и заполнить
          клиента и план по ходу.
        </p>
        {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
        <div className="mt-6 flex w-full max-w-sm flex-col gap-3">
          <Button
            type="button"
            className="w-full"
            disabled={busy}
            onClick={() => setPickerOpen(true)}
          >
            Выбрать клиента и начать
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={busy}
            onClick={() => router.replace('/trainer/live/now')}
          >
            Начать без клиента
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => router.replace('/trainer')}
          >
            На главную
          </Button>
        </div>

        <ResponsiveSheet
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          title="Клиент"
          description="Запись создастся на текущее время"
          desktop="dialog"
        >
          <div className="space-y-3 pb-2">
            <input
              className="input w-full"
              placeholder="Поиск…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={busy}
                  className="flex w-full rounded-2xl border border-white/10 px-3 py-2.5 text-left text-sm text-zinc-200 hover:bg-white/5"
                  onClick={() => void startWithClient(c)}
                >
                  {c.firstName} {c.lastName}
                </button>
              ))}
              {filtered.length === 0 ? (
                <p className="px-1 text-sm text-zinc-500">Нет клиентов в базе</p>
              ) : null}
            </div>
          </div>
        </ResponsiveSheet>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#070708] px-6 text-center text-sm text-zinc-400">
      {error ? (
        <div className="space-y-3">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => router.replace('/trainer')}
            className="rounded-2xl bg-forma-500 px-4 py-2 text-sm font-semibold text-ink"
          >
            На главную
          </button>
        </div>
      ) : (
        <p>Открываем таймер…</p>
      )}
    </div>
  );
}
