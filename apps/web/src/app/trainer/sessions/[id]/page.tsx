'use client';

import { SessionPlanEditor } from '@/components/personal-training/session-plan-editor';
import { useParams, useSearchParams } from 'next/navigation';

export default function TrainerPersonalSessionPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const clientId = searchParams.get('clientId');
  const backHref = clientId
    ? `/trainer/clients/${clientId}`
    : '/trainer';
  const backLabel = clientId ? 'Карточка клиента' : 'Кабинет тренера';

  return (
    <SessionPlanEditor
      bookingId={id}
      backHref={backHref}
      backLabel={backLabel}
      viewerRole="trainer"
    />
  );
}
