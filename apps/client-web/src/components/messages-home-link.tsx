'use client';

import { MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function unreadLabel(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'непрочитанное сообщение';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return 'непрочитанных сообщения';
  }
  return 'непрочитанных сообщений';
}

interface MessagesHomeLinkProps {
  href: string;
}

export function MessagesHomeLink({ href }: MessagesHomeLinkProps) {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    api
      .chatUnreadCount(token)
      .then((data) => setUnread(data.chat))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-1">
      {unread > 0 && (
        <p className="text-center text-sm text-fitgo-400">
          {unread} {unreadLabel(unread)}
        </p>
      )}
      <Link
        href={href}
        className="card relative flex flex-col items-center gap-2 py-6"
      >
        <MessageCircle className="h-8 w-8 text-fitgo-400" />
        <span className="font-medium">Сообщения</span>
        {unread > 0 && (
          <span className="absolute right-3 top-3 flex h-6 min-w-6 items-center justify-center rounded-full bg-fitgo-500 px-1.5 text-xs font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Link>
    </div>
  );
}
