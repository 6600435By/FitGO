'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type NotificationItem } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';
import { PushSubscribeButton } from '@/components/push-subscribe-button';
import { ChatInbox } from '@/components/chat/chat-inbox';

type PageTab = 'chat' | 'alerts';
type MessageFilter = 'all' | 'pending' | 'completed' | 'unread';

const FILTERS: { id: MessageFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'pending', label: 'Новые' },
  { id: 'unread', label: 'Непрочитанные' },
  { id: 'completed', label: 'Обработанные' },
];

export default function AdminNotificationsPage() {
  const [tab, setTab] = useState<PageTab>('chat');
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [filter, setFilter] = useState<MessageFilter>('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;

    setLoading(true);
    api
      .notifications(token, filter)
      .then(setNotifications)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [filter]);

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Сообщения</h2>
        <PushSubscribeButton />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('chat')}
          className={`flex-1 rounded-full px-3 py-2 text-sm ${
            tab === 'chat'
              ? 'bg-fitgo-500 text-white'
              : 'bg-slate-800 text-slate-400'
          }`}
        >
          Чаты с клиентами
        </button>
        <button
          type="button"
          onClick={() => setTab('alerts')}
          className={`flex-1 rounded-full px-3 py-2 text-sm ${
            tab === 'alerts'
              ? 'bg-fitgo-500 text-white'
              : 'bg-slate-800 text-slate-400'
          }`}
        >
          Уведомления
        </button>
      </div>

      {tab === 'chat' ? (
        <ChatInbox role="admin" />
      ) : error ? (
        <p className="text-red-400">{error}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`rounded-full px-3 py-1 text-sm ${
                  filter === f.id
                    ? 'bg-fitgo-500 text-white'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="card text-center text-slate-400">
              <p>Нет уведомлений по выбранному фильтру</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className={`card ${n.read ? 'opacity-80' : 'border-fitgo-500/20'}`}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{n.title}</p>
                      {n.senderName && (
                        <p className="text-xs text-slate-500">
                          От: {n.senderName}
                        </p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-1 text-xs ${
                        n.status === 'COMPLETED'
                          ? 'bg-emerald-400/10 text-emerald-400'
                          : 'bg-amber-400/10 text-amber-400'
                      }`}
                    >
                      {n.status === 'COMPLETED' ? 'Обработано' : 'Новое'}
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
                    {n.status === 'PENDING' && (
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
        </>
      )}
    </div>
  );
}
