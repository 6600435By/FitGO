const KEY = 'forma_welcome_seen';

export function hasSeenWelcome(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true;
  }
}

export function markWelcomeSeen() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* private mode */
  }
}
