import { UserRole } from '@fitgo/shared-types';
import type { AuthUser } from './api';

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

export function getHomePath(roles: UserRole[]): string {
  if (roles.includes(UserRole.SUPER_ADMIN)) return '/super-admin';
  if (roles.includes(UserRole.ADMIN)) return '/admin';
  if (roles.includes(UserRole.TRAINER)) return '/trainer';
  return '/client';
}
