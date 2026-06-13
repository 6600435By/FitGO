'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

interface MessageRecipient {
  id: string;
  firstName: string;
  lastName: string;
}

export function SendClientMessageForm() {
  const [recipients, setRecipients] = useState<MessageRecipient[]>([]);
  const [clientId, setClientId] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api
      .trainerMessageRecipients(token)
      .then(setRecipients)
      .catch(() => setRecipients([]));
  }, []);

  const handleSend = async () => {
    const token = getToken();
    if (!token || !message.trim() || !clientId) return;

    setSending(true);
    setFeedback('');
    try {
      await api.trainerSendMessage(token, clientId, message.trim());
      setMessage('');
      setFeedback('Сообщение отправлено клиенту');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Не удалось отправить');
    } finally {
      setSending(false);
    }
  };

  if (recipients.length === 0) {
    return (
      <div className="card space-y-2 text-center text-slate-400">
        <p>Нет клиентов для переписки</p>
        <p className="text-sm">
          Клиент появится после записи к вам или добавления в вашу базу
        </p>
        <Link href="/trainer/clients" className="text-sm text-fitgo-400">
          Мои клиенты →
        </Link>
      </div>
    );
  }

  return (
    <div className="card space-y-3">
      <h3 className="font-medium">Написать клиенту</h3>

      <select
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        className="w-full rounded-xl bg-slate-800 px-3 py-2 text-sm"
      >
        <option value="">Выберите клиента</option>
        {recipients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.firstName} {client.lastName}
          </option>
        ))}
      </select>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Ваше сообщение клиенту..."
        rows={3}
        className="w-full rounded-xl bg-slate-800 px-3 py-2 text-sm"
      />

      {feedback && <p className="text-sm text-fitgo-400">{feedback}</p>}

      <button
        type="button"
        onClick={handleSend}
        disabled={sending || !message.trim() || !clientId}
        className="btn-primary w-full disabled:opacity-50"
      >
        {sending ? 'Отправка...' : 'Отправить'}
      </button>
    </div>
  );
}
