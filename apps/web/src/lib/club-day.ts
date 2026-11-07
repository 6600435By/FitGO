/** Club calendar timezone (no DST). */
export const CLUB_TZ = 'Europe/Minsk';

/** Calendar day YYYY-MM-DD in club TZ (Europe/Minsk), not UTC. */
export function clubDayIso(date: Date | string | number = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CLUB_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(typeof date === 'object' && date instanceof Date ? date : new Date(date));
}
