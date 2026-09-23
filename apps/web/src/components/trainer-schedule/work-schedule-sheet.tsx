'use client';

import type { TrainerAvailabilityBlock, TrainerCalendarEvent } from '@fitgo/shared-types';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { dateKey } from './schedule-grid';

export function WorkScheduleSheet({
  periodStart,
  periodEnd,
  availabilityBlocks,
  dutyEvents,
  onClose,
  onUpdated,
}: {
  periodStart: string;
  periodEnd: string;
  availabilityBlocks: TrainerAvailabilityBlock[];
  dutyEvents: TrainerCalendarEvent[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [selectedDate, setSelectedDate] = useState(
    format(new Date(periodStart), 'yyyy-MM-dd'),
  );
  const [side, setSide] = useState<'before' | 'after'>('after');
  const [edgeTime, setEdgeTime] = useState('23:30');
  const [dutyId, setDutyId] = useState('');
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

  const dutiesForDate = useMemo(
    () => dutyEvents.filter((event) => dateKey(new Date(event.startAt)) === selectedDate),
    [dutyEvents, selectedDate],
  );
  const duty = dutiesForDate.find((event) => event.id === dutyId) ?? dutiesForDate[0];

  const timeOf = (iso: string) => format(new Date(iso), 'HH:mm');

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
    if (!duty) {
      setMessage('В этот день нет дежурства. Его ставит администратор.');
      return;
    }
    const boundary = side === 'before' ? timeOf(duty.startAt) : timeOf(duty.endAt);
    const from = side === 'before' ? edgeTime : boundary;
    const to = side === 'before' ? boundary : edgeTime;
    if (from >= to) {
      setMessage(
        side === 'before'
          ? 'Начало должно быть раньше дежурства'
          : 'Конец должен быть позже дежурства',
      );
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const withoutSameSide = existingDraftPayload.filter((block) => {
        if (dateKey(new Date(block.startAt)) !== selectedDate) return true;
        const sameSide =
          side === 'before'
            ? timeOf(block.endAt) === timeOf(duty.startAt)
            : timeOf(block.startAt) === timeOf(duty.endAt);
        return !sameSide;
      });
      await saveDraftBlocks([...withoutSameSide, buildBlock(selectedDate, from, to)]);
      setMessage('Сохранено в черновик. Опубликуйте, чтобы клиенты увидели запись.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
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
          <h2 className="text-lg font-semibold">Время вне дежурства</h2>
          <p className="text-sm text-slate-400">
            Только сразу до или после дежурства. Клиенты могут записаться, ставка за эти часы не начисляется.
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
          <p className="font-medium">До или после дежурства</p>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="input"
          />
          {dutiesForDate.length === 0 ? (
            <p className="text-sm text-slate-400">
              В этот день дежурства нет. Его ставит администратор в графике смен.
            </p>
          ) : (
            <>
              {dutiesForDate.length > 1 && (
                <select
                  className="input w-full"
                  value={duty?.id ?? ''}
                  onChange={(e) => setDutyId(e.target.value)}
                >
                  {dutiesForDate.map((event) => (
                    <option key={event.id} value={event.id}>
                      Дежурство {timeOf(event.startAt)}–{timeOf(event.endAt)}
                    </option>
                  ))}
                </select>
              )}
              {duty && dutiesForDate.length === 1 && (
                <p className="text-sm text-sky-200">
                  Дежурство {timeOf(duty.startAt)}–{timeOf(duty.endAt)}. Его меняет только администратор.
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  className={side === 'before' ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
                  onClick={() => setSide('before')}
                >
                  До
                </button>
                <button
                  type="button"
                  className={side === 'after' ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
                  onClick={() => setSide('after')}
                >
                  После
                </button>
              </div>
              <label className="block text-xs text-slate-400">
                {side === 'before' ? 'Начать приём с' : 'Принимать до'}
                <input
                  type="time"
                  value={edgeTime}
                  onChange={(e) => setEdgeTime(e.target.value)}
                  className="input mt-1"
                />
              </label>
              {duty && (
                <p className="text-xs text-slate-500">
                  {side === 'before'
                    ? `Запись ${edgeTime}–${timeOf(duty.startAt)}. Ставка не начисляется.`
                    : `Запись ${timeOf(duty.endAt)}–${edgeTime}. Ставка не начисляется.`}
                </p>
              )}
              <button
                type="button"
                onClick={handleSaveDay}
                disabled={busy || !duty}
                className="btn-primary text-sm disabled:opacity-50"
              >
                Сохранить в черновик
              </button>
            </>
          )}
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
