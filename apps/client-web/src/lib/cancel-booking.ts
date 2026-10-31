import type { Booking } from '@fitgo/shared-types';
import { SessionType } from '@fitgo/shared-types';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

/** Confirmations belong in UI Sheets — this only calls the API. */
export async function cancelGroupBooking(
  sessionId: string,
  _title?: string,
  _opts?: { skipConfirm?: boolean },
): Promise<{ success: boolean; message?: string }> {
  const token = getToken();
  if (!token) {
    return { success: false, message: 'Не авторизован' };
  }

  return api.clientCancelBooking(token, sessionId);
}

/** Confirmations belong in UI Sheets — this only calls the API. */
export async function cancelClientBooking(
  booking: Booking,
  _opts?: { skipConfirm?: boolean },
): Promise<{ success: boolean; message?: string }> {
  const token = getToken();
  if (!token) {
    return { success: false, message: 'Не авторизован' };
  }

  if (booking.source === 'fitgo' && booking.type === SessionType.SPA) {
    try {
      await api.clientCancelSpaBooking(token, booking.sessionId);
      return { success: true };
    } catch (e) {
      return {
        success: false,
        message:
          e instanceof Error
            ? e.message
            : 'Не удалось отменить. Свяжитесь с администратором.',
      };
    }
  }

  if (booking.source === 'fitgo') {
    return api.clientCancelPersonalBooking(token, booking.sessionId);
  }

  return api.clientCancelBooking(token, booking.sessionId);
}
