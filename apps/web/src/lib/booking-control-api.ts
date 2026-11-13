import type { BookingControlApi } from '@/components/booking-control/booking-control-panel';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export type BookingControlApiBase = 'admin' | 'super-admin';

/** Deep-link to SPA board edit dialog for admin / manager / super-admin. */
export function spaBookingEditHrefForBase(
  base: BookingControlApiBase,
): (
  bookingId: string,
  meta?: { startAt?: string; specialistId?: string },
) => string {
  const path = base === 'super-admin' ? '/super-admin/spa' : '/admin/spa';
  return (bookingId, meta) => {
    const q = new URLSearchParams({ booking: bookingId });
    const day = meta?.startAt?.slice(0, 10);
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) q.set('day', day);
    if (meta?.specialistId?.trim()) q.set('specialist', meta.specialistId.trim());
    return `${path}?${q}`;
  };
}

/** Shared BookingControlPanel API wired to admin or super-admin routes. */
export function createBookingControlApi(
  base: BookingControlApiBase,
): BookingControlApi {
  return {
    list: async (params) => {
      const token = getToken();
      if (!token) return [];
      return api.bookingControlList(token, base, params);
    },
    detail: async (sessionKey) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlDetail(token, base, sessionKey);
    },
    openRemark: async (sessionKey, comment, assigneeId) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlRemark(
        token,
        base,
        sessionKey,
        comment,
        assigneeId,
      );
    },
    resolveRemark: async (sessionKey, adminComment) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlResolve(token, base, sessionKey, adminComment);
    },
    listRemarkAssignees: async () => {
      const token = getToken();
      if (!token) return [];
      return api.bookingControlRemarkAssignees(token, base);
    },
    assignRemark: async (sessionKey, assigneeId) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlAssignRemark(
        token,
        base,
        sessionKey,
        assigneeId,
      );
    },
    listPerformers: async () => {
      const token = getToken();
      if (!token) return [];
      const staff =
        base === 'super-admin'
          ? await api.payrollStaff(token)
          : await api.adminPayrollStaff(token);
      return staff
        .map((s) => ({ id: s.userId, name: s.name }))
        .filter((s) => s.id && s.name)
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    },
    refreshFrom1c: async (from, to) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlRefreshFrom1c(token, base, { from, to });
    },
    setAttendance: async (sessionKey, clientExternalId, attendance) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlSetAttendance(token, base, {
        sessionKey,
        clientExternalId,
        attendance,
      });
    },
    excludeMember: async (sessionKey, clientExternalId) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlExcludeMember(token, base, {
        sessionKey,
        clientExternalId,
      });
    },
    approveGroup: async (sessionKey, comment) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlApprove(token, base, sessionKey, comment);
    },
    bulkApproveGroups:
      base === 'super-admin'
        ? async (body) => {
            const token = getToken();
            if (!token) throw new Error('Нет сессии');
            return api.bookingControlBulkApprove(token, body);
          }
        : undefined,
    returnGroupApproval: async (sessionKey, comment) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlReturnApproval(token, base, sessionKey, comment);
    },
    managerRework:
      base === 'super-admin'
        ? async (body) => {
            const token = getToken();
            if (!token) throw new Error('Нет сессии');
            return api.bookingControlManagerRework(token, body);
          }
        : undefined,
    listReworkAssignees:
      base === 'super-admin'
        ? async () => {
            const token = getToken();
            if (!token) return [];
            return api.bookingControlReworkAssignees(token);
          }
        : undefined,
    listReworkTasks:
      base === 'super-admin'
        ? async (sessionKey) => {
            const token = getToken();
            if (!token) return [];
            return api.bookingControlReworkTasks(token, sessionKey);
          }
        : undefined,
    linkSpaSale: async (bookingId, saleExternalId, applyServiceId) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlSpaLinkSale(token, base, {
        bookingId,
        saleExternalId,
        applyServiceId,
      });
    },
    linkSpaVisit: async (bookingId, onexExternalId) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlSpaLinkVisit(token, base, {
        bookingId,
        onexExternalId,
      });
    },
    unlinkSpaDocument: async (bookingId) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlSpaUnlink(token, base, bookingId);
    },
    linkPtDocument: async (bookingId, docExternalId) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlPtLinkDoc(token, base, {
        bookingId,
        docExternalId,
      });
    },
    markPtNoBasis: async (bookingId) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlPtNoBasis(token, base, bookingId);
    },
    payrollHoldPreview: async (sessionKey) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.payrollHoldPreview(token, base, sessionKey);
    },
    adoptSpaToJournal: async (sessionKey, serviceId) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlSpaAdoptJournal(token, base, {
        sessionKey,
        serviceId,
      });
    },
    bulkAdoptSpaToJournal: async (sessionKeys) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlSpaAdoptJournalBulk(token, base, sessionKeys);
    },
    updateSpaService: async (bookingId, serviceId) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      await api.adminUpdateSpaBooking(token, bookingId, { serviceId });
    },
    updateSpaGuestPhone: async (bookingId, guestPhone, opts) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      const res = await api.adminUpdateSpaBooking(token, bookingId, {
        ...(guestPhone.trim() ? { guestPhone } : {}),
        ...(opts?.guestName?.trim()
          ? { guestName: opts.guestName.trim() }
          : {}),
        cascadeClientLink: opts?.cascadeClientLink,
      });
      return res.cascade;
    },
    listSpaServices: async () => {
      const token = getToken();
      if (!token) return [];
      const rows = await api.adminSpaServices(token);
      return rows
        .filter((s) => s.active !== false)
        .map((s) => ({ id: s.id, name: s.name }));
    },
    listHallSnapshots: async (sessionKey) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlHallSnapshots(token, base, sessionKey);
    },
    loadHallSnapshotImage: async (snapshotId) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlHallSnapshotImageUrl(token, base, snapshotId);
    },
  };
}
