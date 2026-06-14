type PublicUser = {
  firstName: string;
  lastName: string;
  gamificationNickname?: string | null;
  useRealNameInPublic?: boolean;
};

export function getPublicDisplayName(user: PublicUser): string {
  if (user.useRealNameInPublic === false && user.gamificationNickname) {
    return user.gamificationNickname;
  }
  return `${user.firstName} ${user.lastName}`.trim();
}
