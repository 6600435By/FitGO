import confetti from 'canvas-confetti';
import { downloadIcsEvent } from '@/lib/ics';

type ToastSuccess = (
  title: string,
  opts?: {
    description?: string;
    actionLabel?: string;
    onAction?: () => void;
  },
) => void;

export type CelebrateBookingOpts = {
  title: string;
  startAt: string;
  endAt?: string;
  location?: string;
  description?: string;
  /** Toast title; default «Вы записаны: {title}». */
  toastTitle?: string;
  toastDescription?: string;
};

/** Confetti + vibrate + success toast with «В календарь» (.ics). */
export function celebrateBooking(
  toast: { success: ToastSuccess },
  opts: CelebrateBookingOpts,
) {
  void confetti({
    particleCount: 70,
    spread: 60,
    origin: { y: 0.7 },
    colors: ['#FFD000', '#FFFFFF', '#FFE685'],
  });
  try {
    navigator.vibrate?.(40);
  } catch {
    /* ignore */
  }

  const description =
    opts.toastDescription ??
    new Date(opts.startAt).toLocaleString('ru-RU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  toast.success(opts.toastTitle ?? `Вы записаны: ${opts.title}`, {
    description,
    actionLabel: 'В календарь',
    onAction: () =>
      downloadIcsEvent({
        title: opts.title,
        startAt: opts.startAt,
        endAt: opts.endAt,
        location: opts.location ?? 'Forma',
        description: opts.description,
      }),
  });
}
