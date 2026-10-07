import { isFormaClubUuid } from '@fitgo/1c-adapter';

export { isFormaClubUuid };

/**
 * Prefer a real Forma club UUID from Club.externalId; otherwise FORMA_CLUB_ID.
 * A non-UUID seed id (`1c-club-001`) is replaced from Forma `GET /clubs/`
 * during schedule sync — that id is what triggers 1025
 * «Не найдена структурная единица».
 */
export function resolveFormaClubId(
  clubExternalId: string | null | undefined,
  envClubId: string | null | undefined = process.env.FORMA_CLUB_ID,
): { clubId: string; source: 'club' | 'env' | 'none' } {
  const fromClub = clubExternalId?.trim() ?? '';
  const fromEnv = envClubId?.trim() ?? '';

  if (isFormaClubUuid(fromClub)) {
    return { clubId: fromClub, source: 'club' };
  }
  if (isFormaClubUuid(fromEnv)) {
    return { clubId: fromEnv, source: 'env' };
  }
  if (fromEnv) {
    return { clubId: fromEnv, source: 'env' };
  }
  if (fromClub) {
    return { clubId: fromClub, source: 'club' };
  }
  return { clubId: '', source: 'none' };
}

