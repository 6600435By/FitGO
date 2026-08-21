'use client';

import type { TrainerAvailabilityBlock } from '@fitgo/shared-types';
import { format, addDays, endOfMonth, startOfMonth } from 'date-fns';
import { ru } from 'date-fns/locale';
import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { dateKey, weekDayKeys } from './schedule-grid';

export function WorkScheduleSheet({
  periodStart,
  periodEnd,
  availabilityBlocks,
  onClose,
  onUpdated,
}: {
  periodStart: string;
  periodEnd: string;
  availabilityBlocks: TrainerAvailabilityBlock[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [selectedDate, setSelectedDate] = useState(
    format(new Date(periodStart), 'yyyy-MM-dd'),
  );
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('18:00');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const draftBlocks = availabilityBlocks.filter((b) => b.status === 'DRAFT');
  const publishedBlocks = availabilityBlocks.filter((b) => b.status === 'PUBLISHED');

  const publishedForDate = useMemo(
    () =>
      publishedBlocks.filter(
        (b) => dateKey(new Date(b.startAt)) === selectedDate,
      ),
    [publishedBlocks, selectedDate],
  );

  const saveDraftBlocks = async (
    blocks: Array<{ startAt: string; endAt: string }>,
  ) => {
    const token = getToken();
    if (!token) return;

    await api.trainerSetAvailabilityBlocks(token, {
      periodStart,
      periodEnd,
      blocks,
    });
    onUpdated();
  };

  const buildBlock = (dateStr: string, from: string, to: string) => {
    const startAt = new Date(`${dateStr}T${from}:00`);
    const endAt = new Date(`${dateStr}T${to}:00`);
    return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
  };

  const existingDraftPayload = draftBlocks.map((b) => ({
    startAt: b.startAt,
    endAt: b.endAt,
  }));

  const handleSaveDay = async () => {
    if (startTime >= endTime) {
      setMessage('Время начала должно быть раньше окончания');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const withoutSameDay = existingDraftPayload.filter(
        (b) => dateKey(new Date(b.startAt)) !== selectedDate,
      );
      await saveDraftBlocks([
        ...withoutSameDay,
        buildBlock(selectedDate, startTime, endTime),
      ]);
      setMessage('Сохранено в черновик');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const copyRangeToDates = async (dates: string[]) => {
    if (startTime >= endTime) {
      setMessage('Задайте корректный интервал времени');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const replaceKeys = new Set(dates);
      const kept = existingDraftPayload.filter(
        (b) => !replaceKeys.has(dateKey(new Date(b.startAt))),
      );
      const added = dates.map((d) => buildBlock(d, startTime, endTime));
      await saveDraftBlocks([...kept, ...added]);
      setMessage(`Скопировано на ${dates.length} дн.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyWeek = () => {
    const week = weekDayKeys(new Date(`${selectedDate}T12:00:00`));
    void copyRangeToDates(week);
  };

  const handleCopyMonth = () => {
    const anchor = new Date(`${selectedDate}T12:00:00`);
    const start = startOfMonth(anchor);
    const end = endOfMonth(anchor);
    const dates: string[] = [];
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      dates.push(dateKey(d));
    }
    void copyRangeToDates(dates);
  };

  const handleRemoveDraft = async (blockId: string) => {
    const next = draftBlocks
      .filter((b) => b.id !== blockId)
      .map((b) => ({ startAt: b.startAt, endAt: b.endAt }));
    await saveDraftBlocks(next);
  };

  const handlePublish = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await api.trainerPublishSchedule(token, periodStart, periodEnd);
      setMessage(`Опубликовано слотов: ${result.publishedBlocks}`);
      onUpdated();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка публикации');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold">График работы</h2>
          <p className="text-sm text-slate-400">
            Открытое время для записи — по конкретным датам
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-800"
          aria-label="Закрыть"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {message && (
          <p className="rounded-xl bg-fitgo-500/10 px-3 py-2 text-sm text-fitgo-400">
            {message}
          </p>
        )}

        <div className="card space-y-3">
          <p className="font-medium">День и часы приёма</p>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="input"
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-slate-400">С</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">До</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="input"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSaveDay}
              disabled={busy}
              className="btn-primary text-sm disabled:opacity-50"
            >
              Сохранить день
            </button>
            <button
              type="button"
              onClick={handleCopyWeek}
              disabled={busy}
              className="btn-secondary text-sm disabled:opacity-50"
            >
              Копировать на неделю
            </button>
            <button
              type="button"
              onClick={handleCopyMonth}
              disabled={busy}
              className="btn-secondary text-sm disabled:opacity-50"
            >
              Копировать на месяц
            </button>
          </div>
        </div>

        {publishedForDate.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-300">Опубликовано на этот день</p>
            {publishedForDate.map((block) => (
              <div key={block.id} className="card text-sm text-emerald-300/90">
                {format(new Date(block.startAt), 'HH:mm', { locale: ru })} —{' '}
                {format(new Date(block.endAt), 'HH:mm', { locale: ru })}
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-300">
            Черновики ({draftBlocks.length})
          </p>
          {draftBlocks.length === 0 ? (
            <p className="text-sm text-slate-500">Нет черновиков — сохраните день и опубликуйте</p>
          ) : (
            draftBlocks.map((block) => (
              <div
                key={block.id}
                className="card flex items-center justify-between gap-2 text-sm"
              >
                <span>
                  {format(new Date(block.startAt), 'd MMM, HH:mm', { locale: ru })} —{' '}
                  {format(new Date(block.endAt), 'HH:mm', { locale: ru })}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveDraft(block.id)}
                  className="text-xs text-red-400 hover:underline"
                >
                  Удалить
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="border-t border-slate-800 p-4">
        <button
          type="button"
          onClick={handlePublish}
          disabled={busy || draftBlocks.length === 0}
          className="btn-primary w-full disabled:opacity-50"
        >
          {busy ? 'Публикация...' : `Опубликовать (${draftBlocks.length})`}
        </button>
      </div>
    </div>
  );
}
