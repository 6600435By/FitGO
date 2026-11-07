'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { liveHrefForSession } from '@/components/training-live/live-href';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

/** Resolves nearest PT/GP and opens fullscreen live timer. */
export default function TrainerLiveEntryPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

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
          setError('Нет ближайшей тренировки на сегодня');
          return;
        }
        const href = liveHrefForSession(next);
        if (!href) {
          setError('Не удалось открыть режим тренировки');
          return;
        }
        const q = new URLSearchParams();
        if (next.title) q.set('title', next.title);
        if (next.clientId) q.set('clientId', next.clientId);
        const qs = q.toString();
        router.replace(`${href}${qs ? `?${qs}` : ''}`);
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить расписание');
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

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
