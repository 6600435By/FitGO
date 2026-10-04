'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { BookingControlPanel } from '@/components/booking-control/booking-control-panel';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function AdminBookingControlInner() {
  const searchParams = useSearchParams();
  const initialSessionKey = searchParams.get('sessionKey')?.trim() || undefined;
  const initialFrom = searchParams.get('from')?.trim() || undefined;
  const initialTo = searchParams.get('to')?.trim() || undefined;

  const panelApi = useMemo(
    () => ({
      list: async (params: {
        from: string;
        to: string;
        kind?: string;
        status?: string;
        needsReview?: boolean;
        payment?: string;
      }) => {
        const token = getToken();
        if (!token) return [];
        return api.bookingControlList(token, 'admin', params);
      },
      detail: async (sessionKey: string) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        return api.bookingControlDetail(token, 'admin', sessionKey);
      },
      openRemark: async (sessionKey: string, comment: string) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        return api.bookingControlRemark(token, 'admin', sessionKey, comment);
      },
      resolveRemark: async (sessionKey: string, adminComment: string) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        return api.bookingControlResolve(
          token,
          'admin',
          sessionKey,
          adminComment,
        );
      },
      refreshFrom1c: async (from: string, to: string) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        return api.bookingControlRefreshFrom1c(token, 'admin', { from, to });
      },
      setAttendance: async (
        sessionKey: string,
        clientExternalId: string,
        attendance: 'ATTENDED' | 'NO_SHOW',
      ) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        return api.bookingControlSetAttendance(token, 'admin', {
          sessionKey,
          clientExternalId,
          attendance,
        });
      },
      approveGroup: async (sessionKey: string, comment?: string) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        return api.bookingControlApprove(token, 'admin', sessionKey, comment);
      },
      returnGroupApproval: async (sessionKey: string, comment?: string) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        return api.bookingControlReturnApproval(
          token,
          'admin',
          sessionKey,
          comment,
        );
      },
      listHallSnapshots: async (sessionKey: string) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        return api.bookingControlHallSnapshots(token, 'admin', sessionKey);
      },
      loadHallSnapshotImage: async (snapshotId: string) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        return api.bookingControlHallSnapshotImageUrl(
          token,
          'admin',
          snapshotId,
        );
      },
    }),
    [],
  );

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
