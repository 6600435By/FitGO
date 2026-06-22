export interface WorkoutTimerDockChrome {
  atTop: boolean;
  active: boolean;
  /** Полноэкранный таймер сессии — скрыть шапку */
  overlayOpen?: boolean;
}

const CHROME_EVENT = 'workout-timer-dock-chrome';

export function emitWorkoutTimerDockChrome(detail: WorkoutTimerDockChrome) {
  window.dispatchEvent(new CustomEvent(CHROME_EVENT, { detail }));
}

export function subscribeWorkoutTimerDockChrome(
  listener: (detail: WorkoutTimerDockChrome) => void,
) {
  const handler = (e: Event) =>
    listener((e as CustomEvent<WorkoutTimerDockChrome>).detail);
  window.addEventListener(CHROME_EVENT, handler);
  return () => window.removeEventListener(CHROME_EVENT, handler);
}
