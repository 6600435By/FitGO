'use client';

import { SessionPlanEditor } from '@/components/personal-training/session-plan-editor';
import { useParams } from 'next/navigation';

export default function ClientPersonalSessionPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <SessionPlanEditor
      bookingId={id}
      backHref="/client/bookings"
      backLabel="Мои записи"
      viewerRole="client"
    />
  );
}
