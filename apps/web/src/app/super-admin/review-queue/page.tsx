'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { BookingControlPanel } from '@/components/booking-control/booking-control-panel';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { createBookingControlApi } from '@/lib/booking-control-api';

function SuperAdminBookingControlInner() {
  const searchParams = useSearchParams();
  const initialSessionKey = searchParams.get('sessionKey')?.trim() || undefined;
  const initialFrom = searchParams.get('from')?.trim() || undefined;
  const initialTo = searchParams.get('to')?.trim() || undefined;
  const initialNeedsReview =
    searchParams.get('needsReview') === '1' ||
    searchParams.get('needsReview') === 'true';
  const paymentRaw = searchParams.get('payment')?.trim()?.toUpperCase();
  const initialPayment =
    paymentRaw === 'DEBT' || paymentRaw === 'PAID' || paymentRaw === 'GIFT'
      ? paymentRaw
      : 'ALL';
  const kindRaw = searchParams.get('kind')?.trim()?.toUpperCase();
  const initialKind =
    kindRaw === 'GROUP' || kindRaw === 'PT' || kindRaw === 'SPA'
      ? kindRaw
      : undefined;
  const statusRaw = searchParams.get('status')?.trim()?.toUpperCase();
  const initialStatus =
    statusRaw === 'COMPLETED' ||
    statusRaw === 'SCHEDULED' ||
    statusRaw === 'CANCELLED'
      ? statusRaw
      : undefined;
  const initialPerformerId =
    searchParams.get('performerId')?.trim() || undefined;
  const initialPayTag = searchParams.get('payTag')?.trim() || undefined;

  const panelApi = useMemo(() => createBookingControlApi('super-admin'), []);

  return (
    <BookingControlPanel
      api={panelApi}
      canResolve
      canMarkAttendance
      canApproveGroup
      canBulkApprove
      canReturnApproval
      canViewHallPhotos
      initialSessionKey={initialSessionKey}
      initialFrom={initialFrom}
      initialTo={initialTo}
      initialNeedsReview={initialNeedsReview}
      initialPayment={initialPayment}
      initialKind={initialKind}
      initialStatus={initialStatus}
      initialPerformerId={initialPerformerId}
      initialPayTag={initialPayTag}
      cancelSpaBooking={async (bookingId) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        await api.adminCancelSpaBooking(token, bookingId);
      }}
      subtitle="Можно подтвердить ГП без тренера и админа или вернуть на доработку. Без подтверждения занятие не идёт в ЗП."
    />
  );
}

export default function SuperAdminBookingControlPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Загрузка…</p>}>
      <SuperAdminBookingControlInner />
    </Suspense>
  );
}
