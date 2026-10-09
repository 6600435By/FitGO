'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { BookingControlPanel } from '@/components/booking-control/booking-control-panel';
import { getUser } from '@/lib/auth';
import { createTrainerBookingControlApi } from '@/lib/trainer-booking-control-api';

function TrainerMySessionsInner() {
  const searchParams = useSearchParams();
  const user = getUser();
  const isGp = Boolean(user?.groupPrograms);
  const initialFrom = searchParams.get('from')?.trim() || undefined;
  const initialTo = searchParams.get('to')?.trim() || undefined;
  const initialNeedsReview =
    searchParams.get('needsReview') === '1' ||
    searchParams.get('needsReview') === 'true';
  const paymentRaw = searchParams.get('payment')?.trim()?.toUpperCase();
  const initialPayment =
    paymentRaw === 'DEBT' || paymentRaw === 'PAID' ? paymentRaw : 'ALL';
  const initialSessionKey = searchParams.get('session')?.trim() || undefined;

  const panelApi = useMemo(() => createTrainerBookingControlApi(), []);

  return (
    <BookingControlPanel
      api={panelApi}
      title={isGp ? 'Контроль записей' : 'Мои занятия'}
      subtitle={
        isGp
          ? 'После занятия отметьте кто был, сверьте фото и подтвердите. Явку в 1С ставит администратор.'
          : 'После занятия отметьте галочками кто был, сверьте фото и нажмите «Подтвердить». Явку в 1С ставит администратор.'
      }
      canTrainerSeen
      canApproveGroup
      canViewHallPhotos
      fixedKind={isGp ? 'GROUP' : undefined}
      approvalSegments={isGp}
      initialFrom={initialFrom}
      initialTo={initialTo}
      initialNeedsReview={initialNeedsReview}
      initialPayment={initialPayment}
      initialSessionKey={initialSessionKey}
    />
  );
}

export default function TrainerMySessionsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Загрузка…</p>}>
      <TrainerMySessionsInner />
    </Suspense>
  );
}
