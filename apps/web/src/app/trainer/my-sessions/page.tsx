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
    }),
    [],
  );

  return (
    <BookingControlPanel
      api={panelApi}
      title="Мои занятия"
      subtitle="Только ваши занятия из 1С. Замечание отправит занятие на проверку администратору."
    />
  );
}
