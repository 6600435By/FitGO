'use client';

import type { TrainerWorkSlotInput } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

const DAY_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

interface DraftSlot {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export default function TrainerWorkSchedulePage() {
  const [slots, setSlots] = useState<DraftSlot[]>([]);
  const [bookings, setBookings] = useState<
    Array<{
      id: string;
      clientName: string;
      startAt: string;
      endAt: string;
    }>
  >([]);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () => {
    const token = getToken();
    if (!token) return;

    Promise.all([
      api.trainerWorkSchedule(token),
      api.trainerPersonalBookings(token),
    ])
      .then(([schedule, personalBookings]) => {
        setSlots(schedule);
        setBookings(personalBookings);
      })
      .catch((err) => setMessage(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const addSlot = () => {
    setSlots((prev) => [
      ...prev,
      { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
    ]);
  };

  const updateSlot = (
    index: number,
    field: keyof DraftSlot,
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
      const saved = await api.trainerSetWorkSchedule(
        token,
        slots as TrainerWorkSlotInput[],
      );
      setSlots(saved);
      setMessage('График сохранён');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">График работы</h2>
        <p className="mt-1 text-sm text-slate-400">
          Клиенты смогут записываться на персональные тренировки в указанные часы
        </p>
      </div>

      {message && (
        <p className="rounded-xl bg-fitgo-500/10 px-3 py-2 text-sm text-fitgo-400">
          {message}
        </p>
      )}

      <div className="space-y-3">
        {slots.map((slot, index) => (
          <div key={index} className="card grid gap-3 sm:grid-cols-4">
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
              onClick={() => removeSlot(index)}
              className="btn-secondary"
            >
              Удалить
            </button>
          </div>
        ))}

        <div className="flex gap-2">
          <button onClick={addSlot} className="btn-secondary">
            Добавить интервал
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary disabled:opacity-50"
          >
            {saving ? 'Сохранение...' : 'Сохранить график'}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="font-medium">Предстоящие персональные записи</h3>
        {bookings.length === 0 ? (
          <div className="card text-center text-slate-400">
            Нет записей на персональные тренировки
          </div>
        ) : (
          <ul className="space-y-2">
            {bookings.map((booking) => (
              <li key={booking.id} className="card">
                <p className="font-medium">{booking.clientName}</p>
                <p className="text-sm text-slate-400">
                  {formatDateTime(booking.startAt)} —{' '}
                  {formatDateTime(booking.endAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
