'use client';

import { ListGroup, ListRow, PageHeader, Skeleton } from '@fitgo/forma-ui';
import { useEffect, useMemo, useState } from 'react';
import { useFeatures } from '@/components/features-provider';
import { buildTrainerV2Nav } from '@/components/trainer-shell/trainer-nav';
import { api, type AuthUser } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

export default function TrainerMorePage() {
  const { isEnabled } = useFeatures();
  const [user, setUser] = useState<AuthUser | null>(() => getUser());
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    Promise.all([
      api.me(token).catch(() => null),
      isEnabled('messaging')
        ? api.chatUnreadCount(token).catch(() => ({ chat: 0 }))
        : Promise.resolve({ chat: 0 }),
    ]).then(([me, counts]) => {
      if (cancelled) return;
      if (me) setUser(me);
      setUnread(counts.chat ?? 0);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isEnabled]);

  const { more } = useMemo(
    () => buildTrainerV2Nav(user, (k) => isEnabled(k as never)),
    [user, isEnabled],
  );

  if (loading && !user) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48 w-full rounded-3xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ещё"
        subtitle="Табель, смены, оплаты, сообщения и профиль"
      />
      <ListGroup>
        {more.map((item) => {
          const Icon = item.icon;
          const badge =
            item.badgeKey === 'messages' && unread > 0 ? unread : undefined;
          return (
            <ListRow
              key={item.href}
              href={item.href}
              title={item.label}
              leading={<Icon className="h-5 w-5 text-zinc-400" />}
              chevron
              trailing={
                badge ? (
                  <span className="rounded-full bg-forma-500 px-2 py-0.5 font-display text-[11px] font-bold text-ink">
                    {badge > 99 ? '99+' : badge}
                  </span>
                ) : undefined
              }
            />
          );
        })}
      </ListGroup>
    </div>
  );
}
