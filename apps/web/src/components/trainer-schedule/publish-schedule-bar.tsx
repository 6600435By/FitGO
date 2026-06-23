'use client';

import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export function PublishScheduleBar({
  draftBlockCount,
  periodStart,
  periodEnd,
  onPublished,
}: {
  draftBlockCount: number;
  periodStart: string;
  periodEnd: string;
  onPublished: () => void;
}) {
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState('');

  const periodLabel = `${format(new Date(periodStart), 'd MMM', { locale: ru })} — ${format(new Date(periodEnd), 'd MMM yyyy', { locale: ru })}`;

  const handlePublish = async () => {
    const token = getToken();
    if (!token) return;

    setPublishing(true);
    setMessage('');
    try {
      const result = await api.trainerPublishSchedule(
        token,
        periodStart,
        periodEnd,
      );
      setMessage(`Опубликовано слотов: ${result.publishedBlocks}`);
      onPublished();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка публикации');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="sticky bottom-4 z-20 rounded-2xl border border-fitgo-500/30 bg-slate-900/95 p-4 shadow-xl backdrop-blur">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium text-white">Публикация графика</p>
          <p className="text-sm text-slate-400">
            {periodLabel} · черновых слотов: {draftBlockCount}
          </p>
          {message && (
            <p className="mt-1 text-sm text-fitgo-400">{message}</p>
          )}
        </div>
        <button
          type="button"
          onClick={handlePublish}
          disabled={publishing || draftBlockCount === 0}
          className="btn-primary shrink-0 disabled:opacity-50"
        >
          {publishing ? 'Публикация...' : 'Опубликовать'}
        </button>
      </div>
    </div>
  );
}
