'use client';

const STACK_KEY = 'fitgo-nav-stack';
const MAX_STACK = 40;

function readStack(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(STACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeStack(stack: string[]) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STACK_KEY, JSON.stringify(stack));
  } catch {
    /* quota / private mode */
  }
}

function pathOnly(key: string): string {
  return key.split('?')[0] ?? key;
}

/** Full path+query for the current location. */
export function locationKey(pathname: string, search: string): string {
  const q = search.startsWith('?') ? search.slice(1) : search;
  return q ? `${pathname}?${q}` : pathname;
}

/**
 * Record navigation. Same path with different query updates the top entry
 * (tabs/filters). Path change pushes a new entry.
 */
export function recordNavLocation(key: string): number {
  const stack = readStack();
  const top = stack[stack.length - 1];
  if (top === key) return stack.length;
  if (top && pathOnly(top) === pathOnly(key)) {
    stack[stack.length - 1] = key;
  } else {
    stack.push(key);
  }
  while (stack.length > MAX_STACK) stack.shift();
  writeStack(stack);
  return stack.length;
}

/** Pop current entry and return previous location, or null. */
export function popNavLocation(): string | null {
  const stack = readStack();
  if (stack.length < 2) return null;
  stack.pop();
  const prev = stack[stack.length - 1] ?? null;
  writeStack(stack);
  return prev;
}

export function navStackDepth(): number {
  return readStack().length;
}
