'use client';

import { useMemo } from 'react';
import { BookingControlPanel } from '@/components/booking-control/booking-control-panel';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export default function AdminBookingControlPage() {
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
      canViewHallPhotos
    />
  );
}
