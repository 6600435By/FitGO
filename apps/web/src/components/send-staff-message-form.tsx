'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

type RecipientType = 'admin' | 'trainer';

interface ClubTrainer {
  id: string;
  firstName: string;
  lastName: string;
}

export function SendStaffMessageForm({ trainerMode = false }: { trainerMode?: boolean }) {
  const [recipientType, setRecipientType] = useState<RecipientType>('admin');
  const [trainers, setTrainers] = useState<ClubTrainer[]>([]);
  const [trainerId, setTrainerId] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    if (trainerMode) return;
    const token = getToken();
    if (!token) return;
    api
      .clientClubTrainers(token)
      .then(setTrainers)
      .catch(() => setTrainers([]));
  }, [trainerMode]);

  const handleSend = async () => {
    const token = getToken();
    if (!token || !message.trim()) return;
    if (recipientType === 'trainer' && !trainerId) {
      setFeedback('Выберите тренера');
      return;
    }

    setSending(true);
    setFeedback('');
    try {
      await api.sendStaffMessage(token, {
        message: message.trim(),
        recipientType,
        trainerId: recipientType === 'trainer' ? trainerId : undefined,
      });
      setMessage('');
      setFeedback(
        recipientType === 'admin'
          ? 'Сообщение отправлено администратору'
          : 'Сообщение отправлено тренеру',
      );
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Не удалось отправить');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="card space-y-3">
      <h3 className="font-medium">
        {trainerMode ? 'Написать администратору' : 'Написать сообщение'}
      </h3>

      {!trainerMode && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setRecipientType('admin')}
            className={`flex-1 rounded-full px-3 py-2 text-sm ${
              recipientType === 'admin'
                ? 'bg-fitgo-500 text-white'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            Администратору
          </button>
          <button
            type="button"
            onClick={() => setRecipientType('trainer')}
            className={`flex-1 rounded-full px-3 py-2 text-sm ${
              recipientType === 'trainer'
                ? 'bg-fitgo-500 text-white'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            Тренеру
          </button>
        </div>
      )}

      {!trainerMode && recipientType === 'trainer' && (
        <select
          value={trainerId}
          onChange={(e) => setTrainerId(e.target.value)}
          className="w-full rounded-xl bg-slate-800 px-3 py-2 text-sm"
        >
          <option value="">Выберите тренера</option>
          {trainers.map((trainer) => (
            <option key={trainer.id} value={trainer.id}>
              {trainer.firstName} {trainer.lastName}
            </option>
          ))}
        </select>
      )}

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={
          recipientType === 'admin'
            ? 'Ваш вопрос администрации клуба...'
            : 'Ваш вопрос тренеру...'
        }
        rows={3}
        className="w-full rounded-xl bg-slate-800 px-3 py-2 text-sm"
      />

      {feedback && <p className="text-sm text-fitgo-400">{feedback}</p>}

      <button
        type="button"
        onClick={handleSend}
        disabled={sending || !message.trim()}
        className="btn-primary w-full disabled:opacity-50"
      >
        {sending ? 'Отправка...' : 'Отправить'}
      </button>
    </div>
  );
}
