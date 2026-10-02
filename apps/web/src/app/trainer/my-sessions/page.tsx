'use client';

import { useMemo } from 'react';
import { BookingControlPanel } from '@/components/booking-control/booking-control-panel';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export default function TrainerMySessionsPage() {
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
        return api.bookingControlList(token, 'trainer', params);
      },
      detail: async (sessionKey: string) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        return api.bookingControlDetail(token, 'trainer', sessionKey);
      },
      openRemark: async (sessionKey: string, comment: string) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        return api.bookingControlRemark(token, 'trainer', sessionKey, comment);
      },
      saveTrainerSeen: async (sessionKey: string, seenClientIds: string[]) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        return api.bookingControlTrainerSeen(token, sessionKey, seenClientIds);
      },
      approveGroup: async (sessionKey: string, comment?: string) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        return api.bookingControlApprove(token, 'trainer', sessionKey, comment);
      },
      listHallSnapshots: async (sessionKey: string) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        return api.bookingControlHallSnapshots(token, 'trainer', sessionKey);
      },
      loadHallSnapshotImage: async (snapshotId: string) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        return api.bookingControlHallSnapshotImageUrl(
          token,
          'trainer',
          snapshotId,
        );
      },
    }),
    [],
  );

  return (
    <BookingControlPanel
      api={panelApi}
      title="Мои занятия"
      subtitle="После занятия отметьте галочками кто был, сверьте фото и нажмите «Подтвердить». Явку в 1С ставит администратор."
      canTrainerSeen
      canApproveGroup
      canViewHallPhotos
    />
  );
}
