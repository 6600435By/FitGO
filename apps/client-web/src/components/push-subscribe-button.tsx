'use client';

import { useState } from 'react';
import { pushSupported, requestAndSubscribePush } from '@/lib/push';

export function PushSubscribeButton() {
  const [status, setStatus] = useState<'idle' | 'done' | 'error'>('idle');

  const subscribe = async () => {
    if (!pushSupported()) {
      setStatus('error');
      return;
    }

    try {
      const result = await requestAndSubscribePush();
      setStatus(result === 'subscribed' ? 'done' : 'error');
    } catch {
      setStatus('error');
    }
  };

  if (status === 'done') {
    return (
      <span className="text-xs font-medium text-forma-400">Push включён</span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void subscribe()}
      className="rounded-xl border border-white/10 bg-ink-raised px-3 py-1.5 text-xs font-medium text-white touch-manipulation hover:bg-ink-elevated"
    >
      {status === 'error' ? 'Push недоступен' : 'Включить push'}
    </button>
  );
}
