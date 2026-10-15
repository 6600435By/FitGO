import { UserRole } from '@fitgo/shared-types';
import type { AuthUser } from './api';

const TOKEN_KEY = 'fitgo_spec_token';
const USER_KEY = 'fitgo_spec_user';

export function saveAuth(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
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

/** Merge fields into the cached session user (e.g. name refresh from /auth/me). */
export function patchStoredUser(patch: Partial<AuthUser>): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const prev = getUser();
  if (!prev) return null;
  const next = { ...prev, ...patch };
  localStorage.setItem(USER_KEY, JSON.stringify(next));
  return next;
}

export function requireSpecialist(user: AuthUser | null): boolean {
  return Boolean(user?.roles.includes(UserRole.SPECIALIST));
}

export function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** ISO / Date → value for `<input type="datetime-local">` in local TZ. */
export function toDatetimeLocalValue(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
