'use client';

import { Button, ResponsiveSheet } from '@fitgo/forma-ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { LiveTimerScreen } from '@/components/training-live/live-timer-screen';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

type ClientOpt = {
  id: string;
  firstName: string;
  lastName: string;
};

/** Ad-hoc live session without a booking — attach a client when ready. */
export default function TrainerLiveNowPage() {
  const router = useRouter();
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
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
      .catch(() => undefined);
  }, []);

  const meta = useMemo(
    () => ({
      kind: 'hall' as const,
      title: 'Тренировка сейчас',
      planHref: '/trainer',
    }),
    [],
  );

  const filtered = clients.filter((c) => {
    const hay = `${c.firstName} ${c.lastName}`.toLowerCase();
    return !q.trim() || hay.includes(q.trim().toLowerCase());
  });

  const attach = async (client: ClientOpt) => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setError('');
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
      setError(err instanceof Error ? err.message : 'Не удалось привязать');
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <LiveTimerScreen meta={meta} hallHref="/trainer/live/hall" />
      <div className="pointer-events-none fixed inset-x-0 bottom-[max(5.5rem,env(safe-area-inset-bottom))] z-30 flex justify-center px-4">
        <div className="pointer-events-auto flex max-w-md flex-col items-center gap-2">
          {error ? <p className="text-xs text-red-400">{error}</p> : null}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => setPickerOpen(true)}
          >
            Привязать клиента
          </Button>
        </div>
      </div>

      <ResponsiveSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Привязать клиента"
        description="Создаётся запись на текущее время"
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
                onClick={() => void attach(c)}
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
