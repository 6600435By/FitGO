/** In-memory mark so layout does not bounce back to welcome after finish. */

const EVENT = 'fitgo-trainer-onboarded';

let sessionOnboarded = false;

export function markTrainerOnboarded() {
  sessionOnboarded = true;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(EVENT));
  }
}

export function readTrainerOnboardedMark() {
  return sessionOnboarded;
}

export function subscribeTrainerOnboarded(cb: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
