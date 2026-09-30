'use client';

import { useMemo } from 'react';
import { BookingControlPanel } from '@/components/booking-control/booking-control-panel';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export default function SpecialistMySessionsPage() {
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
        return api.bookingControlList(token, 'specialist', {
          ...params,
          kind: 'SPA',
        });
      },
      detail: async (sessionKey: string) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        return api.bookingControlDetail(token, 'specialist', sessionKey);
      },
      openRemark: async (sessionKey: string, comment: string) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        return api.bookingControlRemark(
          token,
          'specialist',
          sessionKey,
          comment,
        );
      },
    }),
    [],
  );

  return (
    <BookingControlPanel
      api={panelApi}
      fixedKind="SPA"
      title="Мои занятия"
      subtitle="Ваши SPA-занятия из 1С. Замечание отправит запись на проверку."
    />
  );
}
