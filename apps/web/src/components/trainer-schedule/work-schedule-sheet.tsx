'use client';

import type { TrainerAvailabilityBlock } from '@fitgo/shared-types';
import { addDays, format, startOfWeek } from 'date-fns';
import { ru } from 'date-fns/locale';
import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DateField, TimeField } from '@/components/ui/date-field';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { dateKey } from './schedule-grid';

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
  /** @deprecated duty no longer required — kept for call-site compat */
  dutyEvents?: unknown;
  freeSchedule?: boolean;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [selectedDate, setSelectedDate] = useState(
    format(new Date(periodStart), 'yyyy-MM-dd'),
  );
  const [fromTime, setFromTime] = useState('09:00');
  const [toTime, setToTime] = useState('18:00');
  const [copyDays, setCopyDays] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const draftBlocks = availabilityBlocks.filter((b) => b.status === 'DRAFT');
  const publishedBlocks = availabilityBlocks.filter(
    (b) => b.status === 'PUBLISHED',
  );

  const draftsForDate = useMemo(
    () =>
      draftBlocks.filter(
        (b) => dateKey(new Date(b.startAt)) === selectedDate,
      ),
    [draftBlocks, selectedDate],
  );

  const publishedForDate = useMemo(
    () =>
      publishedBlocks.filter(
        (b) => dateKey(new Date(b.startAt)) === selectedDate,
      ),
    [publishedBlocks, selectedDate],
  );

  const weekDays = useMemo(() => {
    const start = startOfWeek(new Date(`${selectedDate}T12:00:00`), {
      weekStartsOn: 1,
    });
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i);
      return {
        key: format(d, 'yyyy-MM-dd'),
        label: format(d, 'EEE d', { locale: ru }),
      };
    });
  }, [selectedDate]);

  const buildBlock = (dateStr: string, from: string, to: string) => {
    const startAt = new Date(`${dateStr}T${from}:00`);
    const endAt = new Date(`${dateStr}T${to}:00`);
    return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
  };

  const existingDraftPayload = draftBlocks.map((b) => ({
    startAt: b.startAt,
    endAt: b.endAt,
  }));

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

  const handleAddInterval = async () => {
    if (fromTime >= toTime) {
      setMessage('Начало должно быть раньше конца');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const dates = [selectedDate, ...copyDays.filter((d) => d !== selectedDate)];
      const added = dates.map((d) => buildBlock(d, fromTime, toTime));
      await saveDraftBlocks([...existingDraftPayload, ...added]);
      setMessage(
        copyDays.length
          ? 'Время сохранено на выбранные дни. Откройте клиентам, когда будете готовы.'
          : 'Время сохранено. Клиенты его не видят, пока не нажмёте «Открыть клиентам».',
      );
      setCopyDays([]);
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
    setBusy(true);
    try {
      await saveDraftBlocks(next);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const toggleCopyDay = (key: string) => {
    if (key === selectedDate) return;
    setCopyDays((prev) =>
      prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key],
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-ink text-zinc-100">
      <header className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Рабочее время</h2>
          <p className="text-sm text-zinc-400">
            Это ваше время. Клиенты его не увидят, пока не нажмёте «Открыть
            клиентам».
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-zinc-400 hover:bg-white/10"
          aria-label="Закрыть"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {message ? (
          <p className="rounded-xl bg-forma-500/10 px-3 py-2 text-sm text-forma-400">
            {message}
          </p>
        ) : null}

        <div className="card space-y-3">
          <p className="font-medium">Часы на день</p>
          <DateField
            label="Дата"
            value={selectedDate}
            onChange={setSelectedDate}
          />
          <div className="grid grid-cols-2 items-start gap-3">
            <TimeField label="С" value={fromTime} onChange={setFromTime} />
            <TimeField label="По" value={toTime} onChange={setToTime} />
          </div>
          <div className="space-y-2">
            <p className="text-xs text-zinc-500">Так же на другие дни недели</p>
            <div className="flex flex-wrap gap-1.5">
              {weekDays.map((d) => {
                const active =
                  d.key === selectedDate || copyDays.includes(d.key);
                return (
                  <button
                    key={d.key}
                    type="button"
                    disabled={d.key === selectedDate}
                    onClick={() => toggleCopyDay(d.key)}
                    className={`rounded-full px-2.5 py-1 text-xs ${
                      active
                        ? 'bg-forma-500 text-ink'
                        : 'border border-white/10 text-zinc-400'
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={handleAddInterval}
            disabled={busy}
            className="btn-primary text-sm disabled:opacity-50"
          >
            Добавить время
          </button>
        </div>

        {publishedForDate.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-zinc-300">
              Уже открыто клиентам
            </p>
            {publishedForDate.map((block) => (
              <div key={block.id} className="card text-sm text-emerald-300/90">
                {format(new Date(block.startAt), 'HH:mm', { locale: ru })} —{' '}
                {format(new Date(block.endAt), 'HH:mm', { locale: ru })}
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium text-zinc-300">
            Ещё не открыто ({draftsForDate.length})
          </p>
          {draftsForDate.length === 0 ? (
            <p className="text-sm text-zinc-500">
              На этот день нет сохранённого времени
            </p>
          ) : (
            draftsForDate.map((block) => (
              <div
                key={block.id}
                className="card flex items-center justify-between gap-2 text-sm"
              >
                <span>
                  {format(new Date(block.startAt), 'HH:mm', { locale: ru })} —{' '}
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
    </div>
  );
}
