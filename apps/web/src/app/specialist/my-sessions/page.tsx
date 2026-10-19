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
  const initialClient = searchParams.get('client')?.trim() || undefined;
  const initialClientId = searchParams.get('clientId')?.trim() || undefined;

  const panelApi = useMemo(
    () => ({
      list: async (params: {
        from: string;
        to: string;
        kind?: string;
        status?: string;
        needsReview?: boolean;
        payment?: string;
        client?: string;
        clientId?: string;
        notIn1c?: boolean;
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
      updateSpaService: async (bookingId: string, serviceId: string) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        await api.specialistUpdateSpaBooking(token, bookingId, { serviceId });
      },
      listSpaServices: async () => {
        const token = getToken();
        if (!token) return [];
        const rows = await api.specialistOwnServices(token);
        return rows
          .filter((s) => s.active !== false)
          .map((s) => ({ id: s.id, name: s.name }));
      },
    }),
    [],
  );

  return (
    <BookingControlPanel
      api={panelApi}
      fixedKind="SPA"
      title="Контроль записей"
      subtitle="Ваши SPA-записи. Подтвердите услугу — затем админ допустит в ЗП."
      canApproveGroup
      approvalActor="performer"
      initialFrom={initialFrom}
      initialTo={initialTo}
      initialNeedsReview={initialNeedsReview}
      initialPayment={initialPayment}
      initialClient={initialClient}
      initialClientId={initialClientId}
      spaBookingEditHref={(bookingId) =>
        `/specialist/schedule?booking=${encodeURIComponent(bookingId)}`
      }
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
