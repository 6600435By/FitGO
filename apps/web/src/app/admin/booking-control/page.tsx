'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { BookingControlPanel } from '@/components/booking-control/booking-control-panel';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { createBookingControlApi } from '@/lib/booking-control-api';

function AdminBookingControlInner() {
  const searchParams = useSearchParams();
  const initialSessionKey = searchParams.get('sessionKey')?.trim() || undefined;
  const initialFrom = searchParams.get('from')?.trim() || undefined;
  const initialTo = searchParams.get('to')?.trim() || undefined;
  const initialNeedsReview =
    searchParams.get('needsReview') === '1' ||
    searchParams.get('needsReview') === 'true';
  const paymentRaw = searchParams.get('payment')?.trim()?.toUpperCase();
  const initialPayment =
    paymentRaw === 'DEBT' || paymentRaw === 'PAID' ? paymentRaw : 'ALL';

  const panelApi = useMemo(() => createBookingControlApi('admin'), []);

  return (
    <BookingControlPanel
      api={panelApi}
      canResolve
      canMarkAttendance
      canApproveGroup
      canReturnApproval
      canViewHallPhotos
      initialSessionKey={initialSessionKey}
      initialFrom={initialFrom}
      initialTo={initialTo}
      initialNeedsReview={initialNeedsReview}
      initialPayment={initialPayment}
      cancelSpaBooking={async (bookingId) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        await api.adminCancelSpaBooking(token, bookingId);
      }}
      subtitle="ГП: проверьте отметки тренера, поставьте Прибыл/Не прибыл и подтвердите. Без подтверждения занятие не идёт в ЗП."
    />
  );
}

export default function AdminBookingControlPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Загрузка…</p>}>
      <AdminBookingControlInner />
    </Suspense>
  );
}
