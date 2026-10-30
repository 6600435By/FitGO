'use client';

import { ListTodo, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function badgeText(n: number) {
  return n > 99 ? '99+' : String(n);
}

function unreadHint(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} непрочитанное`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${count} непрочитанных`;
  }
  return `${count} непрочитанных`;
}

function tasksHint(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} открытая задача`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${count} открытые задачи`;
  }
  return `${count} открытых задач`;
}

function IconBadgeLink({
  href,
  label,
  title,
  badge,
  icon,
}: {
  href: string;
  label: string;
  title: string;
  badge?: number;
  icon: ReactNode;
}) {
  const show = badge != null && badge > 0;
  return (
    <Link
      href={href}
      className="admin-chrome-btn relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white"
      aria-label={label}
      title={title}
    >
      {icon}
      {show ? (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-fitgo-500 px-0.5 text-[9px] font-semibold leading-none text-white">
          {badgeText(badge)}
        </span>
      ) : null}
    </Link>
  );
}

export function AdminQuickLinks({ taskCount }: { taskCount: number }) {
  const [unread, setUnread] = useState(0);

  const loadUnread = useCallback(() => {
    const token = getToken();
    if (!token) return;
    api
      .chatUnreadCount(token)
      .then((data) => setUnread(data.chat))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadUnread();
    const id = window.setInterval(loadUnread, 30_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') loadUnread();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [loadUnread]);

  const msgTitle = unread > 0 ? unreadHint(unread) : 'Сообщения';
  const taskTitle = taskCount > 0 ? tasksHint(taskCount) : 'Задачи';

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <IconBadgeLink
        href="/admin/notifications?tab=trainers"
        label="Сообщения"
        title={msgTitle}
        badge={unread}
        icon={<MessageCircle className="h-4 w-4" />}
      />
      <IconBadgeLink
        href="/admin/tasks"
        label="Задачи"
        title={taskTitle}
        badge={taskCount}
        icon={<ListTodo className="h-4 w-4" />}
      />
    </div>
  );
}
