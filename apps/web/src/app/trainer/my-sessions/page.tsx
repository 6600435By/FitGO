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
  const { groupCabinet, showPt, isReformer } = trainerCabinetMode(user);
  // Pure GP (no PT / reformers): only GROUP. Otherwise All / GP / PT filter.
  const allowKindFilter = showPt || isReformer;
  const fixedKind =
    groupCabinet && !allowKindFilter ? ('GROUP' as const) : undefined;
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
  const kindRaw = searchParams.get('kind')?.trim()?.toUpperCase();
  const initialKind =
    kindRaw === 'GROUP' || kindRaw === 'PT' || kindRaw === 'ALL'
      ? kindRaw
      : undefined;
  const statusRaw = searchParams.get('status')?.trim()?.toUpperCase();
  const initialStatus =
    statusRaw === 'COMPLETED' ||
    statusRaw === 'SCHEDULED' ||
    statusRaw === 'CANCELLED' ||
    statusRaw === 'ALL'
      ? statusRaw
      : undefined;
  const initialConducted =
    searchParams.get('conducted') === '1' ||
    searchParams.get('conducted') === 'true';

  const panelApi = useMemo(() => createTrainerBookingControlApi(), []);

  return (
    <BookingControlPanel
      api={panelApi}
      title={groupCabinet ? 'Контроль записей' : 'Мои занятия'}
      subtitle={
        groupCabinet
          ? 'Комментарий и состав можно внести до и во время занятия. Подтвердить — после окончания. Явку в 1С ставит администратор.'
          : 'Комментарий и галочки — до и во время занятия. «Подтвердить» — после окончания. Явку в 1С ставит администратор.'
      }
      canTrainerSeen
      canApproveGroup
      approvalActor="performer"
      canViewHallPhotos
      fixedKind={fixedKind}
      trainerKindFilter={allowKindFilter}
      approvalSegments={groupCabinet}
      initialFrom={initialFrom}
      initialTo={initialTo}
      initialNeedsReview={initialNeedsReview}
      initialPayment={initialPayment}
      initialSessionKey={initialSessionKey}
      initialClient={initialClient}
      initialClientId={initialClientId}
      initialKind={initialKind}
      initialStatus={initialStatus}
      initialConducted={initialConducted}
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
