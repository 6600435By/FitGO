'use client';

import { useMemo } from 'react';
import { BookingControlPanel } from '@/components/booking-control/booking-control-panel';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { createBookingControlApi } from '@/lib/booking-control-api';

export default function SuperAdminBookingControlPage() {
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
      cancelSpaBooking={async (bookingId) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        await api.adminCancelSpaBooking(token, bookingId);
      }}
      subtitle="Можно подтвердить ГП без тренера и админа или вернуть на доработку. Без подтверждения занятие не идёт в ЗП."
    />
  );
}
