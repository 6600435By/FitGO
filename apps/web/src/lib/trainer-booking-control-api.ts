import type { BookingControlApi } from '@/components/booking-control/booking-control-panel';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import {
  trainerBookingListCacheKey,
  trainerCacheGet,
  trainerCacheInvalidate,
  trainerCacheSet,
  trainerGpHomeCacheKey,
} from '@/lib/trainer-fetch-cache';

function invalidateTrainerHomeCaches() {
  const uid = getUser()?.id;
  if (!uid) return;
  trainerCacheInvalidate(trainerGpHomeCacheKey(uid, 'lite'));
  trainerCacheInvalidate(trainerGpHomeCacheKey(uid, 'full'));
  trainerCacheInvalidate(`bc-list:${uid}:`);
}

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
      invalidateTrainerHomeCaches();
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
      invalidateTrainerHomeCaches();
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

/** Wire PT hard-delete for BookingControlPanel («Тренер клуб»). */
export function trainerDeletePtBookingFromControl(bookingId: string) {
  const token = getToken();
  if (!token) return Promise.reject(new Error('Нет сессии'));
  return api.trainerDeletePersonalBooking(token, bookingId).then(() => {
    invalidateTrainerHomeCaches();
  });
}

/** Prefetch helper: cached list for instant paint on /trainer/my-sessions. */
export function peekTrainerBookingListCache(
  from: string,
  to: string,
  extraOrKind:
    | string
    | {
        kind?: string;
        payTag?: string;
        flag?: string;
        hall?: string;
        reformer?: string;
      } = { kind: 'ALL' },
) {
  const uid = getUser()?.id;
  if (!uid) return null;
  const extra =
    typeof extraOrKind === 'string'
      ? extraOrKind || listExtra({ kind: 'ALL' })
      : listExtra({ kind: 'ALL', ...extraOrKind });
  return trainerCacheGet<
    import('@fitgo/shared-types').BookingControlListItem[]
  >(trainerBookingListCacheKey(uid, from, to, extra));
}

/** Warm keys used by journal soft-paint (month + pending lookback). */
export function prefetchTrainerJournalLists(opts?: {
  kind?: string;
  lookbackDays?: number;
}) {
  const token = getToken();
  const uid = getUser()?.id;
  if (!token || !uid) return;
  const kind = opts?.kind ?? 'ALL';
  const to = new Date().toISOString().slice(0, 10);
  const monthFrom = `${to.slice(0, 8)}01`;
  const lookback = opts?.lookbackDays ?? 45;
  const fromLookback = new Date(Date.now() - lookback * 86400000)
    .toISOString()
    .slice(0, 10);
  const extra = listExtra({ kind });
  for (const [from, rangeTo] of [
    [monthFrom, to],
    [fromLookback, to],
  ] as const) {
    const cacheKey = trainerBookingListCacheKey(uid, from, rangeTo, extra);
    if (trainerCacheGet(cacheKey)) continue;
    void api
      .bookingControlList(token, 'trainer', { from, to: rangeTo, kind })
      .then((rows) => trainerCacheSet(cacheKey, rows))
      .catch(() => undefined);
  }
}
