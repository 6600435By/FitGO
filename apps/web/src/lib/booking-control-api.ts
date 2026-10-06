import type { BookingControlApi } from '@/components/booking-control/booking-control-panel';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export type BookingControlApiBase = 'admin' | 'super-admin';

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
    openRemark: async (sessionKey, comment) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlRemark(token, base, sessionKey, comment);
    },
    resolveRemark: async (sessionKey, adminComment) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlResolve(token, base, sessionKey, adminComment);
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
