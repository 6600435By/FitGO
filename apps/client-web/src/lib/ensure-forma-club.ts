import { api } from '@/lib/api';
import { getUser, saveAuth } from '@/lib/auth';

/**
 * Single-club product (Forma): if the client has no club yet, join the only
 * available club (prefer slug/name Forma). Silent — no picker UI.
 */
export async function ensureFormaClub(token: string): Promise<{
  name: string;
  address?: string;
  slug?: string;
} | null> {
  try {
    const clubs = await api.clientClubs(token);
    if (!clubs.length) return null;

    const preferred =
      clubs.find((c) => /forma|форм/i.test(c.slug) || /forma|форм/i.test(c.name)) ??
      clubs[0];

    const result = await api.clientJoinClub(token, preferred.slug);
    const user = getUser();
    if (user) {
      saveAuth(token, {
        ...user,
        clubId: result.club.id,
        club: result.club,
      });
    }
    return result.club;
  } catch {
    return null;
  }
}
