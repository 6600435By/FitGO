'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { LiveTimerScreen } from '@/components/training-live/live-timer-screen';

export default function TrainerLiveGpPage() {
  const params = useParams<{ sessionKey: string }>();
  const search = useSearchParams();
  const sessionKey = decodeURIComponent(params.sessionKey || '');
  const title = search.get('title') || 'Групповое занятие';

  const meta = useMemo(
    () => ({
      kind: 'gp' as const,
      sessionKey,
      title,
      planHref: `/trainer/group-journal?session=${encodeURIComponent(sessionKey)}`,
    }),
    [sessionKey, title],
  );

  return <LiveTimerScreen meta={meta} />;
}
