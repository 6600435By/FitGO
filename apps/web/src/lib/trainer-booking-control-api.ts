import type { BookingControlApi } from '@/components/booking-control/booking-control-panel';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

/** BookingControlPanel API for the trainer surface (own sessions only). */
export function createTrainerBookingControlApi(): BookingControlApi {
  return {
    list: async (params) => {
      const token = getToken();
      if (!token) return [];
      return api.bookingControlList(token, 'trainer', params);
    },
    detail: async (sessionKey) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlDetail(token, 'trainer', sessionKey);
    },
    openRemark: async (sessionKey, comment) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlRemark(token, 'trainer', sessionKey, comment);
    },
    saveTrainerSeen: async (sessionKey, seenClientIds) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlTrainerSeen(token, sessionKey, seenClientIds);
    },
    approveGroup: async (sessionKey, comment) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlApprove(token, 'trainer', sessionKey, comment);
    },
    listHallSnapshots: async (sessionKey) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlHallSnapshots(token, 'trainer', sessionKey);
    },
    loadHallSnapshotImage: async (snapshotId) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlHallSnapshotImageUrl(
        token,
        'trainer',
        snapshotId,
      );
    },
  };
}
