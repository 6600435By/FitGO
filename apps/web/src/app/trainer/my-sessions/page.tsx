'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { BookingControlPanel } from '@/components/booking-control/booking-control-panel';
import { getUser } from '@/lib/auth';
import { createTrainerBookingControlApi } from '@/lib/trainer-booking-control-api';
import { trainerCabinetMode } from '@/lib/trainer-cabinet';

function TrainerMySessionsInner() {
  const searchParams = useSearchParams();
  const user = getUser();
  const { groupCabinet, isGp, isReformer } = trainerCabinetMode(user);
  // GP-only: groups. Reformer: GROUP+PT (API filters to reformer hall).
  const fixedKind =
    groupCabinet && isGp && !isReformer
      ? ('GROUP' as const)
      : undefined;
  const initialFrom = searchParams.get('from')?.trim() || undefined;
  const initialTo = searchParams.get('to')?.trim() || undefined;
  const initialNeedsReview =
    searchParams.get('needsReview') === '1' ||
    searchParams.get('needsReview') === 'true';
  const paymentRaw = searchParams.get('payment')?.trim()?.toUpperCase();
  const initialPayment =
    paymentRaw === 'DEBT' || paymentRaw === 'PAID' ? paymentRaw : 'ALL';
  const initialSessionKey = searchParams.get('session')?.trim() || undefined;
  const initialClient = searchParams.get('client')?.trim() || undefined;
  const initialClientId = searchParams.get('clientId')?.trim() || undefined;

  const panelApi = useMemo(() => createTrainerBookingControlApi(), []);

  return (
    <BookingControlPanel
      api={panelApi}
      title={groupCabinet ? 'Контроль записей' : 'Мои занятия'}
      subtitle={
        groupCabinet
          ? 'Отмечать состав можно во время занятия — галочки сохраняются сразу. Подтвердить — после окончания. Явку в 1С ставит администратор.'
          : 'Отмечать галочками можно во время занятия — сохраняется сразу. «Подтвердить» — после окончания. Явку в 1С ставит администратор.'
      }
      canTrainerSeen
      canApproveGroup
      approvalActor="performer"
      canViewHallPhotos
      fixedKind={fixedKind}
      approvalSegments={groupCabinet}
      initialFrom={initialFrom}
      initialTo={initialTo}
      initialNeedsReview={initialNeedsReview}
      initialPayment={initialPayment}
      initialSessionKey={initialSessionKey}
      initialClient={initialClient}
      initialClientId={initialClientId}
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
