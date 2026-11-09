'use client';

import type { TrainerClientDetail, TrainerClientSummary } from '@fitgo/shared-types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/utils';
import { ClientRightsBlocks } from '@/components/trainer-clients/client-rights-blocks';

export function ClientDesktopCard({
  summary,
  onClose,
}: {
  summary: TrainerClientSummary;
  onClose?: () => void;
}) {
  const [detail, setDetail] = useState<TrainerClientDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    setDetail(null);
    setError('');
    api
      .trainerClient(token, summary.id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Ошибка загрузки');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [summary.id]);

  const client = detail;
  const name = `${summary.firstName} ${summary.lastName}`.trim();
  const nowMs = Date.now();
  const previousResult = client?.sessions.find(
    (s) => s.status === 'COMPLETED' && s.hasWorkoutSheet,
  );
  const nextStep = client
    ? [...client.sessions]
        .filter(
          (s) =>
            s.status === 'SCHEDULED' &&
            new Date(s.startAt).getTime() >= nowMs,
        )
        .sort(
          (a, b) =>
            new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
        )[0]
    : undefined;

  return (
    <aside className="sticky top-4 space-y-4 rounded-2xl border border-white/10 bg-ink-elevated/80 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-forma-50">{name}</p>
          {summary.phone ? (
            <p className="text-sm text-forma-400">{summary.phone}</p>
          ) : null}
        </div>
        {onClose ? (
          <button
            type="button"
            className="btn-secondary px-2 py-1 text-xs"
            onClick={onClose}
          >
            Закрыть
          </button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {!client && !error ? (
        <div className="h-24 animate-pulse rounded-xl bg-forma-800/40" />
      ) : null}

      {client ? (
        <div className="space-y-3 text-sm">
          <ClientRightsBlocks client={client} compact />

          <div className="space-y-1 text-xs">
            {previousResult ? (
              <Link
                href={`/trainer/sessions/${previousResult.id}?clientId=${summary.id}`}
                className="block text-forma-400 hover:text-forma-300"
              >
                Прошлый результат · {formatDateTime(previousResult.startAt)}
              </Link>
            ) : (
              <p className="text-forma-500">Прошлого результата с листом нет</p>
            )}
            {nextStep ? (
              <Link
                href={`/trainer/sessions/${nextStep.id}?clientId=${summary.id}`}
                className="block text-forma-400 hover:text-forma-300"
              >
                Следующий шаг · {formatDateTime(nextStep.startAt)}
              </Link>
            ) : (
              <Link
                href={`/trainer/schedule?clientId=${summary.id}`}
                className="block text-forma-400 hover:text-forma-300"
              >
                Записать на следующее занятие
              </Link>
            )}
          </div>

          <p className="text-xs text-forma-500">
            {[
              client.lastVisit ? `ПТ: ${formatDate(client.lastVisit)}` : null,
              client.lastHallVisit
                ? `зал: ${formatDate(client.lastHallVisit)}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Визитов пока нет'}
          </p>

          {client.goals?.length ? (
            <div>
              <p className="text-xs uppercase tracking-wide text-forma-500">
                Цели
              </p>
              <ul className="mt-1 space-y-1 text-forma-200">
                {client.goals.slice(0, 3).map((g) => (
                  <li key={g.id}>· {g.title}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-white/5 pt-3">
        <Link
          href={`/trainer/clients/${summary.id}`}
          className="btn-primary text-sm"
        >
          Карточка
        </Link>
        <Link
          href={`/trainer/schedule?clientId=${summary.id}`}
          className="btn-secondary text-sm"
        >
          Записать
        </Link>
        <Link
          href={`/trainer/messages?clientId=${summary.id}`}
          className="btn-secondary text-sm"
        >
          Написать
        </Link>
      </div>
    </aside>
  );
}
