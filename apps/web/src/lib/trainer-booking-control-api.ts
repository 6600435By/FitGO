import type { BookingControlApi } from '@/components/booking-control/booking-control-panel';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import {
  trainerBookingListCacheKey,
  trainerCacheGet,
  trainerCacheInvalidate,
  trainerCacheSet,
} from '@/lib/trainer-fetch-cache';

function listExtra(params: {
  kind?: string;
  payTag?: string;
  flag?: string;
  hall?: string;
  reformer?: string;
}) {
  return [
    params.kind ?? '',
    params.payTag ?? '',
    params.flag ?? '',
    params.hall ?? '',
    params.reformer ?? '',
  ].join('|');
}

/** BookingControlPanel API for the trainer surface (own sessions only). */
export function createTrainerBookingControlApi(): BookingControlApi {
  return {
    list: async (params) => {
      const token = getToken();
      const uid = getUser()?.id;
      if (!token) return [];
      const extra = listExtra(params);
      const cacheKey = uid
        ? trainerBookingListCacheKey(uid, params.from, params.to, extra)
        : null;
      const soft = cacheKey
        ? trainerCacheGet<
            import('@fitgo/shared-types').BookingControlListItem[]
          >(cacheKey)
        : null;
      try {
        const rows = await api.bookingControlList(token, 'trainer', params);
        if (cacheKey && !params.signal?.aborted) {
          trainerCacheSet(cacheKey, rows);
        }
        return rows;
      } catch (e) {
        if (
          soft &&
          !(params.signal?.aborted) &&
          !(e instanceof Error && e.name === 'AbortError')
        ) {
          return soft;
        }
        throw e;
      }
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
    saveTrainerSeen: async (sessionKey, seenClientIds, comment) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      return api.bookingControlTrainerSeen(
        token,
        sessionKey,
        seenClientIds,
        comment,
      );
    },
    approveGroup: async (sessionKey, comment) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      const updated = await api.bookingControlApprove(
        token,
        'trainer',
        sessionKey,
        comment,
      );
      const uid = getUser()?.id;
      if (uid) trainerCacheInvalidate(`bc-list:${uid}:`);
      return updated;
    },
    reviseSession: async (sessionKey, mode, comment) => {
      const token = getToken();
      if (!token) throw new Error('Нет сессии');
      const updated = await api.bookingControlRevise(
        token,
        'trainer',
        sessionKey,
        mode,
        comment,
      );
      const uid = getUser()?.id;
      if (uid) trainerCacheInvalidate(`bc-list:${uid}:`);
      return updated;
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

/** Prefetch helper: cached list for instant paint on /trainer/my-sessions. */
export function peekTrainerBookingListCache(
  from: string,
  to: string,
  extra = '',
) {
  const uid = getUser()?.id;
  if (!uid) return null;
  return trainerCacheGet<
    import('@fitgo/shared-types').BookingControlListItem[]
  >(trainerBookingListCacheKey(uid, from, to, extra));
}
