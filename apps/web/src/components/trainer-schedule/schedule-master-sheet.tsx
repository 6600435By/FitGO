'use client';

import type { TrainerAvailabilityBlock, TrainerCalendarEvent } from '@fitgo/shared-types';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { X } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { WorkScheduleTemplateEditor } from './work-schedule-template-editor';

export function ScheduleMasterSheet({
  periodStart,
  periodEnd,
  availabilityBlocks,
  groupEvents,
  onClose,
  onUpdated,
  onAssignClient,
}: {
  periodStart: string;
  periodEnd: string;
  availabilityBlocks: TrainerAvailabilityBlock[];
  groupEvents: TrainerCalendarEvent[];
  onClose: () => void;
  onUpdated: () => void;
  onAssignClient: (startAt: string) => void;
}) {
  const [tab, setTab] = useState<'blocks' | 'template'>('blocks');
  const [filling, setFilling] = useState(false);
  const [message, setMessage] = useState('');
  const [newStart, setNewStart] = useState('09:00');
  const [newEnd, setNewEnd] = useState('18:00');
  const [newDate, setNewDate] = useState(
    format(new Date(periodStart), 'yyyy-MM-dd'),
  );

  const draftBlocks = availabilityBlocks.filter((b) => b.status === 'DRAFT');

  const saveBlocks = async (blocks: Array<{ startAt: string; endAt: string }>) => {
    const token = getToken();
    if (!token) return;

    await api.trainerSetAvailabilityBlocks(token, {
      periodStart,
      periodEnd,
      blocks,
    });
    onUpdated();
  };

  const handleFillFromTemplate = async () => {
    const token = getToken();
    if (!token) return;

    setFilling(true);
    setMessage('');
    try {
      await api.trainerFillFromTemplate(token, periodStart, periodEnd);
      setMessage('Период заполнен из шаблона');
      onUpdated();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setFilling(false);
    }
  };

  const handleAddBlock = async () => {
    const startAt = new Date(`${newDate}T${newStart}:00`);
    const endAt = new Date(`${newDate}T${newEnd}:00`);
    if (startAt >= endAt) {
      setMessage('Время начала должно быть раньше окончания');
      return;
    }

    const conflicts = groupEvents.filter(
      (e) =>
        e.kind === 'GROUP' &&
        new Date(e.startAt) < endAt &&
        new Date(e.endAt) > startAt,
    );
    if (conflicts.length > 0) {
      setMessage(
        `Внимание: пересечение с групповым «${conflicts[0].title}». Слот всё равно будет добавлен.`,
      );
    }

    const nextBlocks = [
      ...draftBlocks.map((b) => ({ startAt: b.startAt, endAt: b.endAt })),
      { startAt: startAt.toISOString(), endAt: endAt.toISOString() },
    ];
    await saveBlocks(nextBlocks);
    setMessage('Слот добавлен');
  };

  const handleRemoveBlock = async (blockId: string) => {
    const nextBlocks = draftBlocks
      .filter((b) => b.id !== blockId)
      .map((b) => ({ startAt: b.startAt, endAt: b.endAt }));
    await saveBlocks(nextBlocks);
  };

  const handleAssignAt = (block: TrainerAvailabilityBlock) => {
    const start = new Date(block.startAt);
    onAssignClient(start.toISOString());
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold">Мастер расписания</h2>
          <p className="text-sm text-slate-400">
            {format(new Date(periodStart), 'd MMM', { locale: ru })} —{' '}
            {format(new Date(periodEnd), 'd MMM yyyy', { locale: ru })}
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

      <div className="flex gap-2 border-b border-slate-800 px-4 py-2">
        <button
          type="button"
          onClick={() => setTab('blocks')}
          className={`rounded-lg px-3 py-1.5 text-sm ${
            tab === 'blocks' ? 'bg-fitgo-500 text-white' : 'bg-slate-800 text-slate-300'
          }`}
        >
          Слоты периода
        </button>
        <button
          type="button"
          onClick={() => setTab('template')}
          className={`rounded-lg px-3 py-1.5 text-sm ${
            tab === 'template' ? 'bg-fitgo-500 text-white' : 'bg-slate-800 text-slate-300'
          }`}
        >
          Шаблон недели
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {message && (
          <p className="mb-4 rounded-xl bg-fitgo-500/10 px-3 py-2 text-sm text-fitgo-400">
            {message}
          </p>
        )}

        {tab === 'template' ? (
          <WorkScheduleTemplateEditor />
        ) : (
          <div className="space-y-4">
            <button
              type="button"
              onClick={handleFillFromTemplate}
              disabled={filling}
              className="btn-secondary w-full disabled:opacity-50"
            >
              {filling ? 'Заполнение...' : 'Заполнить период из шаблона'}
            </button>

            <div className="card space-y-3">
              <p className="font-medium">Добавить открытый слот</p>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="input"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="time"
                  value={newStart}
                  onChange={(e) => setNewStart(e.target.value)}
                  className="input"
                />
                <input
                  type="time"
                  value={newEnd}
                  onChange={(e) => setNewEnd(e.target.value)}
                  className="input"
                />
              </div>
              <button type="button" onClick={handleAddBlock} className="btn-primary w-full">
                Добавить слот
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-300">
                Черновые слоты ({draftBlocks.length})
              </p>
              {draftBlocks.length === 0 ? (
                <p className="text-sm text-slate-500">Нет черновых слотов</p>
              ) : (
                draftBlocks.map((block) => (
                  <div key={block.id} className="card flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {format(new Date(block.startAt), 'd MMM, HH:mm', { locale: ru })} —{' '}
                        {format(new Date(block.endAt), 'HH:mm', { locale: ru })}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleAssignAt(block)}
                        className="btn-secondary text-xs"
                      >
                        + Клиент
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveBlock(block.id)}
                        className="btn-secondary text-xs text-red-400"
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
