'use client';

import { MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function unreadHint(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} непрочитанное`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${count} непрочитанных`;
  }
  return `${count} непрочитанных`;
}

export function StaffMessagesBadge({ href }: { href: string }) {
  const [unread, setUnread] = useState(0);

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;
    api
      .chatUnreadCount(token)
      .then((data) => setUnread(data.chat))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 30_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  const title = unread > 0 ? unreadHint(unread) : 'Сообщения';

  return (
    <Link
      href={href}
      className="admin-chrome-btn relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white"
      aria-label="Сообщения"
      title={title}
    >
      <MessageCircle className="h-4 w-4" />
      {unread > 0 ? (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-fitgo-500 px-0.5 text-[9px] font-semibold leading-none text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </Link>
  );
}
