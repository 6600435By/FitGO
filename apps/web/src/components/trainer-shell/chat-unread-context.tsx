'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { useFeatures } from '@/components/features-provider';

export type ChatUnreadSummary = {
  total: number;
  clients: number;
  admin: number;
  staff: number;
};

const EMPTY: ChatUnreadSummary = {
  total: 0,
  clients: 0,
  admin: 0,
  staff: 0,
};

type ChatUnreadContextValue = {
  summary: ChatUnreadSummary;
  refresh: () => Promise<void>;
  /** Optimistic adjust after reading/sending in a scope. */
  adjust: (patch: Partial<ChatUnreadSummary>) => void;
};

const ChatUnreadContext = createContext<ChatUnreadContextValue | null>(null);

async function applyOsBadge(total: number) {
  if (typeof navigator === 'undefined') return;
  try {
    if ('setAppBadge' in navigator) {
      if (total > 0) {
        await navigator.setAppBadge(total);
      } else if ('clearAppBadge' in navigator) {
        await navigator.clearAppBadge();
      }
    }
  } catch {
    // best-effort
  }
}

export function ChatUnreadProvider({ children }: { children: ReactNode }) {
  const { isEnabled } = useFeatures();
  const messagingOn = isEnabled('messaging');
  const [summary, setSummary] = useState<ChatUnreadSummary>(EMPTY);

  const refresh = useCallback(async () => {
    if (!messagingOn) {
      setSummary(EMPTY);
      void applyOsBadge(0);
      return;
    }
    const token = getToken();
    if (!token) return;
    try {
      const data = await api.chatUnreadSummary(token);
      const next = {
        total: data.total ?? 0,
        clients: data.clients ?? 0,
        admin: data.admin ?? 0,
        staff: data.staff ?? 0,
      };
      setSummary(next);
      void applyOsBadge(next.total);
    } catch {
      // keep last known
    }
  }, [messagingOn]);

  const adjust = useCallback((patch: Partial<ChatUnreadSummary>) => {
    setSummary((prev) => {
      const next = {
        total: Math.max(0, patch.total ?? prev.total),
        clients: Math.max(0, patch.clients ?? prev.clients),
        admin: Math.max(0, patch.admin ?? prev.admin),
        staff: Math.max(0, patch.staff ?? prev.staff),
      };
      if (patch.clients != null || patch.admin != null || patch.staff != null) {
        next.total = next.clients + next.admin + next.staff;
      }
      void applyOsBadge(next.total);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!messagingOn) {
      setSummary(EMPTY);
      return;
    }
    void refresh();
    const onVis = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    const interval = window.setInterval(() => {
      if (document.hidden) return;
      void refresh();
    }, 25_000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
      window.clearInterval(interval);
    };
  }, [messagingOn, refresh]);

  const value = useMemo(
    () => ({ summary, refresh, adjust }),
    [summary, refresh, adjust],
  );

  return (
    <ChatUnreadContext.Provider value={value}>
      {children}
    </ChatUnreadContext.Provider>
  );
}

export function useChatUnread() {
  const ctx = useContext(ChatUnreadContext);
  return (
    ctx ?? {
      summary: EMPTY,
      refresh: async () => undefined,
      adjust: () => undefined,
    }
  );
}
