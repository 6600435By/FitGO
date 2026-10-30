'use client';

import { UserRole } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

/**
 * SUPER_ADMIN only. Renders nothing when backup is healthy.
 */
export function BackupStatusBanner({ className = '' }: { className?: string }) {
  const user = getUser();
  const isSuper = Boolean(user?.roles?.includes(UserRole.SUPER_ADMIN));
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isSuper) return;
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const s = await api.superAdminBackupStatus(token);
        if (cancelled) return;
        if (s.warn && s.message) {
          setMessage(s.message);
        } else {
          setMessage(null);
        }
      } catch {
        if (!cancelled) {
          setMessage(
            'Не удалось проверить статус резервной копии. Проверьте API и задачу FitGO-Backup на сервере клуба.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuper]);

  if (!isSuper || !message) return null;

  return (
    <div
      className={`card border border-amber-500/30 bg-amber-500/5 !px-2 !py-1.5 text-xs leading-tight text-amber-200 ${className}`}
      role="status"
    >
      <p className="font-medium text-amber-100">Резервная копия</p>
      <p className="mt-0.5 text-[11px] leading-snug text-amber-200/90">{message}</p>
    </div>
  );
}
