'use client';

import type { PersonalTrainingSlot, TrainerSummary } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

export default function ClientPersonalSchedulePage() {
  const [trainers, setTrainers] = useState<TrainerSummary[]>([]);
  const [selectedTrainerId, setSelectedTrainerId] = useState<string | null>(
    null,
  );
  const [slots, setSlots] = useState<PersonalTrainingSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [bookingSlot, setBookingSlot] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    api
      .clientTrainers(token)
      .then(setTrainers)
      .catch((err) => setMessage(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedTrainerId) {
      setSlots([]);
      return;
    }

    const token = getToken();
    if (!token) return;

    setLoadingSlots(true);
    api
      .clientTrainerSlots(token, selectedTrainerId)
      .then(setSlots)
      .catch((err) => setMessage(err.message))
      .finally(() => setLoadingSlots(false));
  }, [selectedTrainerId]);

  const handleBook = async (startAt: string) => {
    const token = getToken();
    if (!token || !selectedTrainerId) return;

    setBookingSlot(startAt);
    setMessage('');
    try {
      await api.clientBookPersonal(token, selectedTrainerId, startAt);
      setMessage('Вы записаны на персональную тренировку!');
      const updated = await api.clientTrainerSlots(token, selectedTrainerId);
      setSlots(updated);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка записи');
    } finally {
      setBookingSlot(null);
    }
  };

  const selectedTrainer = trainers.find((t) => t.id === selectedTrainerId);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Запись к тренерам клуба. Расписание задаётся тренером в приложении.
      </p>

      {message && (
        <p className="rounded-xl bg-fitgo-500/10 px-3 py-2 text-sm text-fitgo-400">
          {message}
        </p>
      )}

      {trainers.length === 0 ? (
        <div className="card text-center text-slate-400">
          <p>Пока нет тренеров с доступным расписанием</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {trainers.map((trainer) => (
              <button
                key={trainer.id}
                onClick={() => setSelectedTrainerId(trainer.id)}
                className={`rounded-full px-4 py-2 text-sm ${
                  selectedTrainerId === trainer.id
                    ? 'bg-fitgo-500 text-white'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {trainer.firstName} {trainer.lastName}
              </button>
            ))}
          </div>

          {selectedTrainer && (
            <div className="space-y-3">
              <h3 className="font-medium">
                Свободные слоты — {selectedTrainer.firstName}{' '}
                {selectedTrainer.lastName}
              </h3>

              {loadingSlots ? (
                <div className="flex justify-center py-8">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
                </div>
              ) : slots.length === 0 ? (
                <div className="card text-center text-slate-400">
                  Нет свободных слотов на ближайшие две недели
                </div>
              ) : (
                <ul className="space-y-2">
                  {slots.map((slot) => (
                    <li
                      key={slot.startAt}
                      className="card flex items-center justify-between gap-3"
                    >
                      <div>
                        <p className="font-medium">
                          {formatDateTime(slot.startAt)}
                        </p>
                        <p className="text-sm text-slate-400">60 минут</p>
                      </div>
                      <button
                        disabled={bookingSlot === slot.startAt}
                        onClick={() => handleBook(slot.startAt)}
                        className="btn-primary shrink-0 disabled:opacity-50"
                      >
                        Записаться
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
