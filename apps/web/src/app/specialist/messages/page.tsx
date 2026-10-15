'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChatInbox } from '@/components/chat/chat-inbox';
import { api, type NotificationItem } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

type Tab = 'admin' | 'team' | 'alerts';

const SPA_CANCEL_TITLE = 'Отмена записи в спа-кабинет';

function isSpaCancellation(n: NotificationItem) {
  return n.title === SPA_CANCEL_TITLE;
}

export default function SpecialistMessagesPage() {
  const [tab, setTab] = useState<Tab>('admin');
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [error, setError] = useState('');

  const loadAlerts = useCallback(() => {
    const token = getToken();
    if (!token) return;
    api
      .notifications(token)
      .then(setNotifications)
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка'));
  }, []);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  const markRead = async (id: string) => {
    const token = getToken();
    if (!token) return;
    await api.markNotificationRead(token, id);
    loadAlerts();
  };

  const markComplete = async (id: string) => {
    const token = getToken();
    if (!token) return;
    await api.markNotificationComplete(token, id);
    loadAlerts();
  };

  const alertItems = notifications.filter((n) => isSpaCancellation(n));
  const unreadAlerts = alertItems.filter((n) => !n.read).length;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Сообщения</h2>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('admin')}
          className={`flex-1 rounded-full px-2 py-2 text-sm ${
            tab === 'admin'
              ? 'bg-fitgo-500 text-white'
              : 'bg-slate-800 text-slate-400'
          }`}
        >
          Админ
        </button>
        <button
          type="button"
          onClick={() => setTab('team')}
          className={`flex-1 rounded-full px-2 py-2 text-sm ${
            tab === 'team'
              ? 'bg-fitgo-500 text-white'
              : 'bg-slate-800 text-slate-400'
          }`}
        >
          Команда
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
          {unreadAlerts > 0 ? ` (${unreadAlerts})` : ''}
        </button>
      </div>
      {tab === 'admin' ? (
        <ChatInbox
          key="admin"
          role="trainer"
          scope="admin"
          directThread
          allowStaffChat={false}
        />
      ) : tab === 'team' ? (
        <ChatInbox key="team" role="trainer" scope="staff" allowStaffChat />
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
                <p className="font-medium">{n.title}</p>
                <span
                  className={`shrink-0 rounded-full px-2 py-1 text-xs ${
                    n.status === 'COMPLETED'
                      ? 'bg-slate-700 text-slate-300'
                      : 'bg-amber-400/10 text-amber-400'
                  }`}
                >
                  {n.status === 'COMPLETED' ? 'Прочитано' : 'Новое'}
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
                    Закрыть
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
