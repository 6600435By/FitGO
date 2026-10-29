'use client';

import { Suspense, useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { BookingControlPanel } from '@/components/booking-control/booking-control-panel';
import { ManagerOriginInbox } from '@/components/manager-rework/manager-origin-inbox';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function SpecialistMySessionsInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const initialFrom = searchParams.get('from')?.trim() || undefined;
  const initialSessionKey = searchParams.get('session')?.trim() || undefined;
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
        missingJournal?: boolean;
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
      adoptSpaToJournal: async (sessionKey: string, serviceId?: string) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        return api.bookingControlSpaAdoptJournal(token, 'specialist', {
          sessionKey,
          serviceId,
        });
      },
      bulkAdoptSpaToJournal: async (sessionKeys: string[]) => {
        const token = getToken();
        if (!token) throw new Error('Нет сессии');
        return api.bookingControlSpaAdoptJournalBulk(
          token,
          'specialist',
          sessionKeys,
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

  const listManagerTasks = useCallback(
    (token: string) => api.specialistManagerTasks(token),
    [],
  );
  const completeManagerTask = useCallback(
    (token: string, id: string, comment?: string) =>
      api.specialistManagerTaskDone(token, id, comment),
    [],
  );
  const openManagerSession = useCallback(
    (sessionKey: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set('session', sessionKey);
      router.replace(`${pathname}?${next.toString()}`);
    },
    [pathname, router, searchParams],
  );

  return (
    <div>
      <ManagerOriginInbox
        list={listManagerTasks}
        complete={completeManagerTask}
        onOpenSession={openManagerSession}
      />
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
        initialSessionKey={initialSessionKey}
        initialClient={initialClient}
        initialClientId={initialClientId}
        spaBookingEditHref={(bookingId) =>
          `/specialist/schedule?booking=${encodeURIComponent(bookingId)}`
        }
      />
    </div>
  );
}

export default function SpecialistMySessionsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Загрузка…</p>}>
      <SpecialistMySessionsInner />
    </Suspense>
  );
}
