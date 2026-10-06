/** Forma `club_id` = UUID структурной единицы (не mock `1c-club-001`). */
const FORMA_CLUB_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Prefer a real Forma club UUID from Club.externalId; otherwise FORMA_CLUB_ID.
 * Avoids sync 1025 «Не найдена структурная единица» when DB still has seed mock id.
 */
export function resolveFormaClubId(
  clubExternalId: string | null | undefined,
  envClubId: string | null | undefined = process.env.FORMA_CLUB_ID,
): { clubId: string; source: 'club' | 'env' | 'none' } {
  const fromClub = clubExternalId?.trim() ?? '';
  const fromEnv = envClubId?.trim() ?? '';

  if (FORMA_CLUB_UUID.test(fromClub)) {
    return { clubId: fromClub, source: 'club' };
  }
  if (FORMA_CLUB_UUID.test(fromEnv)) {
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

export function isFormaClubUuid(value: string | null | undefined): boolean {
  return FORMA_CLUB_UUID.test(value?.trim() ?? '');
}
