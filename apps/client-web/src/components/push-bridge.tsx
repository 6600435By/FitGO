'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ensurePushSubscription,
  pushSupported,
  requestAndSubscribePush,
  syncAppBadgeFromUnread,
} from '@/lib/push';
import { getToken } from '@/lib/auth';

/**
 * Registers Web Push when permission is already granted, optionally prompts
 * once, and keeps the home-screen app badge in sync with chat unread.
 */
export function PushBridge({ prompt = true }: { prompt?: boolean }) {
  const [needsPermission, setNeedsPermission] = useState(false);
  const [busy, setBusy] = useState(false);

  const syncBadge = useCallback(() => {
    if (!getToken()) return;
    void syncAppBadgeFromUnread();
  }, []);

  useEffect(() => {
    if (!pushSupported() || !getToken()) return;

    let cancelled = false;

    void (async () => {
      try {
        const result = await ensurePushSubscription();
        if (cancelled) return;
        if (result === 'needs-permission' && prompt) {
          setNeedsPermission(true);
        }
      } catch {
        // ignore
      }
      if (!cancelled) syncBadge();
    })();

    const onVis = () => {
      if (document.visibilityState === 'visible') syncBadge();
    };
    const onFocus = () => syncBadge();
    const onMessage = (event: MessageEvent) => {
      if (
        event.data?.type === 'fitgo-navigate' &&
        typeof event.data.url === 'string'
      ) {
        window.location.assign(event.data.url);
      }
    };

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    const interval = window.setInterval(syncBadge, 60_000);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
      window.clearInterval(interval);
    };
  }, [prompt, syncBadge]);

  const enable = async () => {
    setBusy(true);
    try {
      const result = await requestAndSubscribePush();
      if (result === 'subscribed') {
        setNeedsPermission(false);
        syncBadge();
      } else {
        setNeedsPermission(false);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!needsPermission) return null;

  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-ink-elevated/90 px-3 py-2.5 text-sm text-zinc-300">
      <span>Включить уведомления о сообщениях</span>
      <button
        type="button"
        className="shrink-0 rounded-xl border border-white/10 bg-ink-raised px-3 py-1 text-xs font-medium text-white touch-manipulation hover:bg-white/[0.06] disabled:opacity-50"
        disabled={busy}
        onClick={() => void enable()}
      >
        {busy ? '…' : 'Включить'}
      </button>
    </div>
  );
}
