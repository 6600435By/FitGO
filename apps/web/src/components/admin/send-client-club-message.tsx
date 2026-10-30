'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

/**
 * Admin / super-admin: message one client. Server picks push vs SMS.
 */
export function SendClientClubMessage(props: {
  clientUserId: string;
  clientLabel?: string;
  /** Use super-admin endpoint when true */
  asSuperAdmin?: boolean;
}) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState('');

  const send = async () => {
    const token = getToken();
    if (!token || !message.trim()) return;
    setSending(true);
    setFeedback('');
    try {
      const result = props.asSuperAdmin
        ? await api.superAdminSendClientMessage(
            token,
            props.clientUserId,
            message.trim(),
          )
        : await api.adminSendReminder(
            token,
            props.clientUserId,
            message.trim(),
          );
      const channel =
        result && typeof result === 'object' && 'channel' in result
          ? String((result as { channel?: string }).channel)
          : '';
      const smsId =
        result &&
        typeof result === 'object' &&
        'sms' in result &&
        (result as { sms?: { providerId?: string } }).sms?.providerId;
      setFeedback(
        channel === 'sms'
          ? `Отправлено SMS${smsId ? ` (${smsId})` : ''}`
          : channel === 'push'
            ? 'Отправлено в приложение (push)'
            : 'Сохранено в кабинете клиента',
      );
      setMessage('');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Не удалось отправить');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="card space-y-3">
      <h3 className="font-medium">
        Написать клиенту
        {props.clientLabel ? `: ${props.clientLabel}` : ''}
      </h3>
      <p className="text-xs text-slate-500">
        Если ярлык на телефоне есть — push. Иначе — SMS.
      </p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        className="w-full rounded-xl bg-slate-800 px-3 py-2 text-sm"
        placeholder="Текст сообщения…"
      />
      {feedback && <p className="text-sm text-fitgo-400">{feedback}</p>}
      <button
        type="button"
        className="btn-primary w-full disabled:opacity-50"
        disabled={sending || !message.trim()}
        onClick={() => void send()}
      >
        {sending ? 'Отправка…' : 'Отправить'}
      </button>
    </div>
  );
}
