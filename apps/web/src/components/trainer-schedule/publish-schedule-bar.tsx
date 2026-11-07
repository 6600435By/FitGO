'use client';

import type { SchedulePublishSummary } from '@fitgo/shared-types';
import { Button } from '@fitgo/forma-ui';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { useFeatures } from '@/components/features-provider';

export function PublishScheduleBar({
  draftBlockCount,
  periodStart,
  periodEnd,
  summary,
  onPublished,
}: {
  draftBlockCount: number;
  periodStart: string;
  periodEnd: string;
  summary?: SchedulePublishSummary;
  onPublished: () => void;
}) {
  const { isEnabled } = useFeatures();
  const forma = isEnabled('trainer_ui_v2');
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
      const s = result.summary;
      const seriesBit =
        result.seriesCreated != null && result.seriesCreated > 0
          ? ` · серийных записей: ${result.seriesCreated}`
          : '';
      const conflictBit =
        result.seriesConflicts && result.seriesConflicts.length > 0
          ? ` · конфликтов: ${result.seriesConflicts.length}`
          : '';
      setMessage(
        s
          ? `Опубликовано: окон ${s.windowCount}, занято ${s.occupiedByClients}, свободно ${s.freeForClients}${seriesBit}${conflictBit}`
          : `Опубликовано слотов: ${result.publishedBlocks}${seriesBit}${conflictBit}`,
      );
      onPublished();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка публикации');
    } finally {
      setPublishing(false);
    }
  };

  if (draftBlockCount === 0 && !message) return null;

  const shell = forma
    ? 'sticky bottom-20 z-20 rounded-2xl border border-white/10 bg-ink-elevated/95 p-4 shadow-xl backdrop-blur lg:bottom-4'
    : 'sticky bottom-4 z-20 rounded-2xl border border-fitgo-500/30 bg-slate-900/95 p-4 shadow-xl backdrop-blur';

  return (
    <div className={shell}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className={forma ? 'font-display font-semibold text-white' : 'font-medium text-white'}>
            Публикация графика
          </p>
          <p className="text-sm text-zinc-400">
            {periodLabel} · черновых: {draftBlockCount}
            {summary
              ? ` · окон ${summary.windowCount}, занято ${summary.occupiedByClients}, свободно ${summary.freeForClients}`
              : null}
          </p>
          {message ? (
            <p className={`mt-1 text-sm ${forma ? 'text-forma-400' : 'text-fitgo-400'}`}>
              {message}
            </p>
          ) : null}
        </div>
        {forma ? (
          <Button
            type="button"
            onClick={handlePublish}
            disabled={publishing || draftBlockCount === 0}
            loading={publishing}
            className="shrink-0"
          >
            Опубликовать
          </Button>
        ) : (
          <button
            type="button"
            onClick={handlePublish}
            disabled={publishing || draftBlockCount === 0}
            className="btn-primary shrink-0 disabled:opacity-50"
          >
            {publishing ? 'Публикация...' : 'Опубликовать'}
          </button>
        )}
      </div>
    </div>
  );
}
