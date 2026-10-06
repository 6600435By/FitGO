'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { BookingControlPanel } from '@/components/booking-control/booking-control-panel';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function TrainerMySessionsInner() {
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
      initialFrom={initialFrom}
      initialTo={initialTo}
      initialNeedsReview={initialNeedsReview}
      initialPayment={initialPayment}
    />
  );
}

export default function TrainerMySessionsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Загрузка…</p>}>
      <TrainerMySessionsInner />
    </Suspense>
  );
}
