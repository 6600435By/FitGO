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
    return <span className="text-xs text-fitgo-400">Push включён</span>;
  }

  return (
    <button onClick={() => void subscribe()} className="btn-secondary text-xs px-3 py-1">
      {status === 'error' ? 'Push недоступен' : 'Включить push'}
    </button>
  );
}
