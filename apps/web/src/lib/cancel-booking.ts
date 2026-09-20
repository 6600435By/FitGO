import type { Booking } from '@fitgo/shared-types';
import { SessionType } from '@fitgo/shared-types';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export async function cancelGroupBooking(
  sessionId: string,
  title: string,
): Promise<{ success: boolean; message?: string }> {
  const token = getToken();
  if (!token) {
    return { success: false, message: 'Не авторизован' };
  }

  if (!window.confirm(`Отменить запись на «${title}»?`)) {
    return { success: false, message: 'Отменено' };
  }

  return api.clientCancelBooking(token, sessionId);
}

export async function cancelClientBooking(
  booking: Booking,
): Promise<{ success: boolean; message?: string }> {
  const token = getToken();
  if (!token) {
    return { success: false, message: 'Не авторизован' };
  }

  if (!window.confirm(`Отменить запись на «${booking.title}»?`)) {
    return { success: false, message: 'Отменено' };
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
