import { UserRole } from '@fitgo/shared-types';
import type { AuthUser } from './api';
import { clearViewMemory } from './view-memory';

const TOKEN_KEY = 'fitgo_token';
const USER_KEY = 'fitgo_user';

export function saveAuth(token: string, user: AuthUser) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  clearViewMemory();
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

/** Merge fields into the cached session user (e.g. name refresh from /auth/me). */
export function patchStoredUser(patch: Partial<AuthUser>): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const prev = getUser();
  if (!prev) return null;
  const next = { ...prev, ...patch };
  localStorage.setItem(USER_KEY, JSON.stringify(next));
  return next;
}

/** Client ЛК — separate app (lk.ffs.by). */
export function getClientWebUrl() {
  if (typeof process !== 'undefined') {
    const fromEnv = process.env.NEXT_PUBLIC_CLIENT_WEB_URL?.replace(/\/$/, '');
    if (fromEnv) return fromEnv;
  }
  return 'https://lk.ffs.by';
}

export function getHomePath(
  roles: UserRole[],
  flags?: {
    groupPrograms?: boolean;
    trainerStaff?: boolean;
    trainerClub?: boolean;
  },
): string {
  if (roles.includes(UserRole.SUPER_ADMIN)) return '/super-admin';
  if (roles.includes(UserRole.MANAGER)) return '/super-admin';
  if (roles.includes(UserRole.ADMIN)) return '/admin';
  if (roles.includes(UserRole.TRAINER)) {
    return '/trainer';
  }
  if (roles.includes(UserRole.SPECIALIST)) return '/specialist';
  if (roles.includes(UserRole.TECH)) return '/tech';
  // Client channel is lk.ffs.by — never keep a second client UI on app.ffs.by
  return `${getClientWebUrl()}/client`;
}
