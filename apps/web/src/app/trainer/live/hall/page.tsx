'use client';

import { LiveTimerScreen } from '@/components/training-live/live-timer-screen';

/** Read-only hall / TV mirror synced via BroadcastChannel + localStorage. */
export default function TrainerLiveHallPage() {
  return (
    <LiveTimerScreen
      meta={{ kind: 'hall', title: 'Экран зала' }}
      mirrorOnly
    />
  );
}
