import type { FloorStaffHomeSession } from '@fitgo/shared-types';

/** Fullscreen live timer routes (Forma Coach mode 2). */
export function liveHrefForSession(
  s: FloorStaffHomeSession,
): string | null {
  if (s.kind === 'PT') {
    return `/trainer/live/pt/${encodeURIComponent(s.id)}`;
  }
  if (s.kind === 'GROUP') {
    const key = s.sessionKey || s.id;
    return `/trainer/live/gp/${encodeURIComponent(key)}`;
  }
  return null;
}
