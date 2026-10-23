'use client';

import {
  Building2,
  CalendarX2,
  MessageCircle,
  UsersRound,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, type NotificationItem } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import { trainerCabinetMode } from '@/lib/trainer-cabinet';
import { formatDateTime } from '@/lib/utils';
import { ChatInbox } from '@/components/chat/chat-inbox';

type MessagesTab = 'clients' | 'alerts' | 'admin' | 'team';

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

function ChannelTab({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1.5 py-2 transition ${
        active
          ? 'bg-fitgo-500 text-white shadow-sm shadow-fitgo-500/25'
          : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
      }`}
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-lg ${
          active ? 'bg-white/15' : 'bg-slate-800'
        }`}
      >
        {icon}
      </span>
      <span className="max-w-full truncate text-[10px] font-medium leading-tight sm:text-[11px]">
        {label}
      </span>
    </button>
  );
}

export default function TrainerMessagesPage() {
  const searchParams = useSearchParams();
  const initialClientId = searchParams.get('clientId') ?? undefined;
  const user = getUser();
  const { groupOnlyMessaging } = trainerCabinetMode(user);

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [tab, setTab] = useState<MessagesTab>(
    groupOnlyMessaging ? 'admin' : 'clients',
  );
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
  const unreadAlerts = alertItems.filter((n) => !n.read).length;

  return (
    <div className="space-y-3">
      <h2 className="hidden text-xl font-semibold md:block">Сообщения</h2>

      <div
        className={`grid gap-1 rounded-2xl border border-slate-800 bg-slate-950/70 p-1 ${
          groupOnlyMessaging ? 'grid-cols-3' : 'grid-cols-4'
        }`}
        role="tablist"
        aria-label="Разделы сообщений"
      >
        {!groupOnlyMessaging ? (
          <ChannelTab
            active={tab === 'clients'}
            label="Клиенты"
            icon={<MessageCircle className="h-4 w-4" strokeWidth={2} />}
            onClick={() => setTab('clients')}
          />
        ) : null}
        <ChannelTab
          active={tab === 'admin'}
          label="Админ"
          icon={<Building2 className="h-4 w-4" strokeWidth={2} />}
          onClick={() => setTab('admin')}
        />
        <ChannelTab
          active={tab === 'team'}
          label="Команда"
          icon={<UsersRound className="h-4 w-4" strokeWidth={2} />}
          onClick={() => setTab('team')}
        />
        <ChannelTab
          active={tab === 'alerts'}
          label={
            groupOnlyMessaging
              ? unreadAlerts > 0
                ? `Увед. (${unreadAlerts})`
                : 'Уведомл.'
              : unreadAlerts > 0
                ? `Отмены (${unreadAlerts})`
                : 'Отмены'
          }
          icon={<CalendarX2 className="h-4 w-4" strokeWidth={2} />}
          onClick={() => setTab('alerts')}
        />
      </div>

      {tab === 'clients' && !groupOnlyMessaging ? (
        <ChatInbox
          key="clients"
          role="trainer"
          scope="clients"
          initialClientId={initialClientId}
          allowStaffChat={false}
        />
      ) : tab === 'admin' ? (
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
