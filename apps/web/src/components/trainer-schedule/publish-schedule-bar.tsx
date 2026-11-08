'use client';

import type { SchedulePublishSummary } from '@fitgo/shared-types';
import { Button, ResponsiveSheet } from '@fitgo/forma-ui';
import { endOfDay, format, startOfDay } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { useFeatures } from '@/components/features-provider';

type PublishScope = 'day' | 'week' | 'block';

export function PublishScheduleBar({
  draftBlockCount,
  periodStart,
  periodEnd,
  selectedDate,
  summary,
  onPublished,
}: {
  draftBlockCount: number;
  periodStart: string;
  periodEnd: string;
  /** Calendar cursor day. */
  selectedDate: Date;
  summary?: SchedulePublishSummary;
  onPublished: () => void;
}) {
  const { isEnabled } = useFeatures();
  const forma = isEnabled('trainer_ui_v2');
  const [open, setOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState('');

  const dayStart = startOfDay(selectedDate).toISOString();
  const dayEnd = endOfDay(selectedDate).toISOString();
  const periodLabel = `${format(new Date(periodStart), 'd MMM', { locale: ru })} — ${format(new Date(periodEnd), 'd MMM yyyy', { locale: ru })}`;
  const dayLabel = format(selectedDate, 'd MMMM', { locale: ru });

  const handlePublish = async (scope: PublishScope, blockIds?: string[]) => {
    const token = getToken();
    if (!token) return;

    setPublishing(true);
    setMessage('');
    try {
      const start = scope === 'day' ? dayStart : periodStart;
      const end = scope === 'day' ? dayEnd : periodEnd;
      const result = await api.trainerPublishSchedule(
        token,
        start,
        end,
        blockIds,
      );
      const s = result.summary;
      const seriesBit =
        result.seriesCreated != null && result.seriesCreated > 0
          ? ` · серийных записей: ${result.seriesCreated}`
          : '';
      const conflicts = result.seriesConflicts ?? [];
      const conflictBit =
        conflicts.length > 0 ? ` · конфликтов: ${conflicts.length}` : '';
      setMessage(
        s
          ? `Опубликовано: окон ${s.windowCount}, занято ${s.occupiedByClients}, свободно ${s.freeForClients}${seriesBit}${conflictBit}`
          : `Опубликовано слотов: ${result.publishedBlocks}${seriesBit}${conflictBit}`,
      );
      onPublished();
      setOpen(false);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка публикации');
    } finally {
      setPublishing(false);
    }
  };

  if (draftBlockCount === 0 && !message) return null;

  if (!forma) {
    return (
      <div className="sticky bottom-4 z-20 rounded-2xl border border-fitgo-500/30 bg-slate-900/95 p-4 shadow-xl backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-white">Публикация графика</p>
            <p className="text-sm text-zinc-400">
              {periodLabel} · черновых: {draftBlockCount}
              {summary
                ? ` · окон ${summary.windowCount}, занято ${summary.occupiedByClients}, свободно ${summary.freeForClients}`
                : null}
            </p>
            {message ? (
              <p className="mt-1 text-sm text-fitgo-400">{message}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void handlePublish('week')}
            disabled={publishing || draftBlockCount === 0}
            className="btn-primary shrink-0 disabled:opacity-50"
          >
            {publishing ? 'Публикация...' : 'Опубликовать'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/5 px-3 py-2">
        <p className="text-xs text-amber-100/90">
          Черновиков: {draftBlockCount}
          {summary
            ? ` · окон ${summary.windowCount}, свободно ${summary.freeForClients}`
            : ''}
        </p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={draftBlockCount === 0}
          onClick={() => {
            setMessage('');
            setOpen(true);
          }}
        >
          Опубликовать
        </Button>
      </div>
      {message ? (
        <p className="text-sm text-forma-400">{message}</p>
      ) : null}

      <ResponsiveSheet
        open={open}
        onOpenChange={setOpen}
        title="Публикация графика"
        description="Клиенты видят только опубликованные окна"
        desktop="dialog"
      >
        <div className="space-y-3 pb-2">
          <p className="text-sm text-zinc-400">
            В журнале черновики — янтарные штрихи, опубликованные окна —
            сплошные.
          </p>
          <Button
            type="button"
            className="w-full"
            disabled={publishing}
            loading={publishing}
            onClick={() => void handlePublish('day')}
          >
            Этот день ({dayLabel})
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={publishing}
            onClick={() => void handlePublish('week')}
          >
            Период ({periodLabel})
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => setOpen(false)}
          >
            Закрыть
          </Button>
        </div>
      </ResponsiveSheet>
    </>
  );
}

/** Actions for a single draft availability window. */
export function DraftSlotSheet({
  blockId,
  startAt,
  onClose,
  onPublished,
  onAssign,
}: {
  blockId: string;
  startAt: string;
  onClose: () => void;
  onPublished: () => void;
  onAssign: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const when = format(new Date(startAt), 'd MMM HH:mm', { locale: ru });

  const publishOne = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      const at = new Date(startAt);
      await api.trainerPublishSchedule(
        token,
        startOfDay(at).toISOString(),
        endOfDay(at).toISOString(),
        [blockId],
      );
      onPublished();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Черновик окна"
      description={when}
      desktop="dialog"
    >
      <div className="space-y-3 pb-2">
        <Button
          type="button"
          className="w-full"
          disabled={busy}
          loading={busy}
          onClick={() => void publishOne()}
        >
          Опубликовать это окно
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={busy}
          onClick={onAssign}
        >
          Записать клиента
        </Button>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <Button type="button" variant="ghost" className="w-full" onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </ResponsiveSheet>
  );
}
