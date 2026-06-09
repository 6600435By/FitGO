'use client';

import { useEffect, useState } from 'react';
import { api, type NotificationItem } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';
import { PushSubscribeButton } from '@/components/push-subscribe-button';

export default function ClientNotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [error, setError] = useState('');

  const load = () => {
    const token = getToken();
    if (!token) return;
    api
      .notifications(token)
      .then(setNotifications)
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    load();
  }, []);

  const markRead = async (id: string) => {
    const token = getToken();
    if (!token) return;
    await api.markNotificationRead(token, id);
    load();
  };

  if (error) return <p className="text-red-400">{error}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Уведомления</h2>
        <PushSubscribeButton />
      </div>

      {notifications.length === 0 ? (
        <div className="card text-center text-slate-400">
          <p>Нет уведомлений</p>
          <p className="mt-2 text-sm">
            Включите push, чтобы получать напоминания о тренировках
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => (
            <li
              key={n.id}
              onClick={() => !n.read && markRead(n.id)}
              className={`card cursor-pointer ${n.read ? 'opacity-60' : 'border-fitgo-500/20'}`}
            >
              <p className="font-medium">{n.title}</p>
              <p className="text-sm text-slate-400">{n.body}</p>
              <p className="mt-1 text-xs text-slate-500">
                {formatDateTime(n.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
