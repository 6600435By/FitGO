'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { BookingControlPanel } from '@/components/booking-control/booking-control-panel';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function SpecialistMySessionsInner() {
  const searchParams = useSearchParams();
  const initialFrom = searchParams.get('from')?.trim() || undefined;
  const initialTo = searchParams.get('to')?.trim() || undefined;
  const initialNeedsReview =
    searchParams.get('needsReview') === '1' ||
    searchParams.get('needsReview') === 'true';
  const paymentRaw = searchParams.get('payment')?.trim()?.toUpperCase();
  const initialPayment =
    paymentRaw === 'DEBT' || paymentRaw === 'PAID' ? paymentRaw : 'ALL';

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
      approveGroup: async (sessionKey: string, comment?: string) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        return api.bookingControlApprove(
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
      title="Контроль записей"
      subtitle="Ваши SPA-записи. Подтвердите выполнение — затем админ допустит в ЗП."
      canApproveGroup
      initialFrom={initialFrom}
      initialTo={initialTo}
      initialNeedsReview={initialNeedsReview}
      initialPayment={initialPayment}
    />
  );
}

export default function SpecialistMySessionsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Загрузка…</p>}>
      <SpecialistMySessionsInner />
    </Suspense>
  );
}
