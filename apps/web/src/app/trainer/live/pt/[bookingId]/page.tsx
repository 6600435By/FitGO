'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { LiveTimerScreen } from '@/components/training-live/live-timer-screen';

export default function TrainerLivePtPage() {
  const params = useParams<{ bookingId: string }>();
  const search = useSearchParams();
  const bookingId = decodeURIComponent(params.bookingId || '');
  const title = search.get('title') || 'Персональная тренировка';
  const clientId = search.get('clientId');

  const meta = useMemo(
    () => ({
      kind: 'pt' as const,
      bookingId,
      clientId: clientId || undefined,
      title,
      planHref: clientId
        ? `/trainer/sessions/${bookingId}?clientId=${encodeURIComponent(clientId)}`
        : `/trainer/sessions/${bookingId}`,
    }),
    [bookingId, title, clientId],
  );

  return <LiveTimerScreen meta={meta} />;
}
