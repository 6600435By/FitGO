'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Simple touch pull-to-refresh for mobile scroll containers / document.
 * Triggers `onRefresh` when pulled down past threshold from scrollTop === 0.
 */
export function usePullToRefresh(onRefresh: () => void | Promise<void>) {
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const armed = useRef(false);

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (refreshing) return;
      const scrollTop =
        document.scrollingElement?.scrollTop ?? window.scrollY ?? 0;
      if (scrollTop > 2) {
        armed.current = false;
        return;
      }
      armed.current = true;
      startY.current = e.touches[0]?.clientY ?? 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!armed.current || refreshing) return;
      const y = e.touches[0]?.clientY ?? 0;
      const delta = y - startY.current;
      if (delta > 64) setPulling(true);
      else setPulling(false);
    };

    const onEnd = () => {
      if (!armed.current) return;
      armed.current = false;
      if (!pulling || refreshing) {
        setPulling(false);
        return;
      }
      setPulling(false);
      setRefreshing(true);
      void Promise.resolve(onRefresh()).finally(() => setRefreshing(false));
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
  }, [onRefresh, pulling, refreshing]);

  return { pulling, refreshing };
}
