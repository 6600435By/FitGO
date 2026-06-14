'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, type NotificationItem } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';
import { ChatInbox } from '@/components/chat/chat-inbox';

type MessagesTab = 'clients' | 'alerts' | 'admin';

const CANCELLATION_TITLES = new Set([
  'Отмена группового занятия',
  'Отмена персональной тренировки',
]);

function isCancellation(n: NotificationItem) {
  return CANCELLATION_TITLES.has(n.title);
}

function isPersonalCancellation(n: NotificationItem) {
  return n.title === 'Отмена персональной тренировки';
}

export default function TrainerMessagesPage() {
  const searchParams = useSearchParams();
  const initialClientId = searchParams.get('clientId') ?? undefined;
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [tab, setTab] = useState<MessagesTab>('clients');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;
    api
      .notifications(token)
      .then(setNotifications)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (tab === 'alerts') load();
  }, [tab, load]);

  const markRead = async (id: string) => {
    const token = getToken();
    if (!token) return;
    await api.markNotificationRead(token, id);
    load();
  };

  const markComplete = async (id: string) => {
    const token = getToken();
    if (!token) return;
    await api.markNotificationComplete(token, id);
    load();
  };

  const alertItems = notifications.filter((n) => isCancellation(n));

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Сообщения</h2>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('clients')}
          className={`flex-1 rounded-full px-2 py-2 text-sm ${
            tab === 'clients'
              ? 'bg-fitgo-500 text-white'
              : 'bg-slate-800 text-slate-400'
          }`}
        >
          Чат с клиентами
        </button>
        <button
          type="button"
          onClick={() => setTab('alerts')}
          className={`flex-1 rounded-full px-2 py-2 text-sm ${
            tab === 'alerts'
              ? 'bg-fitgo-500 text-white'
              : 'bg-slate-800 text-slate-400'
          }`}
        >
          Отмены
        </button>
        <button
          type="button"
          onClick={() => setTab('admin')}
          className={`flex-1 rounded-full px-2 py-2 text-sm ${
            tab === 'admin'
              ? 'bg-fitgo-500 text-white'
              : 'bg-slate-800 text-slate-400'
          }`}
        >
          Чат с админом
        </button>
      </div>

      {tab === 'clients' ? (
        <ChatInbox
          key="clients"
          role="trainer"
          scope="clients"
          initialClientId={initialClientId}
        />
      ) : tab === 'admin' ? (
        <ChatInbox key="admin" role="trainer" scope="admin" directThread />
      ) : error ? (
        <p className="text-red-400">{error}</p>
      ) : alertItems.length === 0 ? (
        <div className="card text-center text-slate-400">
          <p>Нет уведомлений об отменах</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {alertItems.map((n) => (
            <li
              key={n.id}
              className={`card ${n.read ? 'opacity-80' : 'border-fitgo-500/20'}`}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{n.title}</p>
                  {n.senderName && (
                    <p className="text-xs text-slate-500">От: {n.senderName}</p>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-1 text-xs ${
                    n.status === 'COMPLETED'
                      ? 'bg-slate-700 text-slate-300'
                      : 'bg-amber-400/10 text-amber-400'
                  }`}
                >
                  {isPersonalCancellation(n)
                    ? n.status === 'COMPLETED'
                      ? 'Обработано'
                      : 'Требует действия'
                    : 'Информация'}
                </span>
              </div>
              <p className="text-sm text-slate-400">{n.body}</p>
              <p className="mt-1 text-xs text-slate-500">
                {formatDateTime(n.createdAt)}
              </p>
              <div className="mt-3 flex gap-2">
                {!n.read && (
                  <button
                    type="button"
                    onClick={() => markRead(n.id)}
                    className="btn-secondary flex-1 text-sm"
                  >
                    Прочитано
                  </button>
                )}
                {isPersonalCancellation(n) && n.status === 'PENDING' && (
                  <button
                    type="button"
                    onClick={() => markComplete(n.id)}
                    className="btn-primary flex-1 text-sm"
                  >
                    Завершить
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
