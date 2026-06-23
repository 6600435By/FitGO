'use client';

import type { TrainerWorkSlotInput } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

const DAY_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export function WorkScheduleTemplateEditor({
  onSaved,
}: {
  onSaved?: () => void;
}) {
  const [slots, setSlots] = useState<TrainerWorkSlotInput[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api.trainerWorkSchedule(token).then(setSlots).catch(() => {});
  }, []);

  const addSlot = () => {
    setSlots((prev) => [
      ...prev,
      { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
    ]);
  };

  const updateSlot = (
    index: number,
    field: keyof TrainerWorkSlotInput,
    value: string | number,
  ) => {
    setSlots((prev) =>
      prev.map((slot, i) =>
        i === index ? { ...slot, [field]: value } : slot,
      ),
    );
  };

  const removeSlot = (index: number) => {
    setSlots((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    const token = getToken();
    if (!token) return;

    setSaving(true);
    setMessage('');
    try {
      const saved = await api.trainerSetWorkSchedule(token, slots);
      setSlots(saved);
      setMessage('Шаблон недели сохранён');
      onSaved?.();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        Шаблон по дням недели — используется для быстрого заполнения периода.
      </p>

      {message && (
        <p className="rounded-xl bg-fitgo-500/10 px-3 py-2 text-sm text-fitgo-400">
          {message}
        </p>
      )}

      {slots.map((slot, index) => (
        <div key={index} className="grid gap-2 rounded-xl bg-slate-800/50 p-3 sm:grid-cols-4">
          <select
            value={slot.dayOfWeek}
            onChange={(e) =>
              updateSlot(index, 'dayOfWeek', Number(e.target.value))
            }
            className="rounded-lg bg-slate-800 px-3 py-2"
          >
            {DAY_LABELS.map((label, day) => (
              <option key={day} value={day}>
                {label}
              </option>
            ))}
          </select>
          <input
            type="time"
            value={slot.startTime}
            onChange={(e) => updateSlot(index, 'startTime', e.target.value)}
            className="rounded-lg bg-slate-800 px-3 py-2"
          />
          <input
            type="time"
            value={slot.endTime}
            onChange={(e) => updateSlot(index, 'endTime', e.target.value)}
            className="rounded-lg bg-slate-800 px-3 py-2"
          />
          <button
            type="button"
            onClick={() => removeSlot(index)}
            className="btn-secondary text-sm"
          >
            Удалить
          </button>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={addSlot} className="btn-secondary text-sm">
          Добавить интервал
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {saving ? 'Сохранение...' : 'Сохранить шаблон'}
        </button>
      </div>
    </div>
  );
}
