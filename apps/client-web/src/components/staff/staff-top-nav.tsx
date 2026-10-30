'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export type StaffTopNavItem = {
  href: string;
  label: string;
  badge?: number;
  /** Exact match for home routes like /specialist or /trainer */
  exact?: boolean;
  matchPrefixes?: string[];
};

function itemActive(pathname: string, item: StaffTopNavItem): boolean {
  if (item.matchPrefixes?.length) {
    return item.matchPrefixes.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );
  }
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function StaffTopNavLinks({ items }: { items: StaffTopNavItem[] }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((item) => {
        const active = itemActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'relative shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition touch-manipulation',
              active
                ? 'bg-fitgo-500/20 text-fitgo-300'
                : 'text-slate-400 hover:text-white',
            )}
          >
            {item.label}
            {item.badge != null && item.badge > 0 ? (
              <span className="ml-1 inline-flex min-w-[1.1rem] justify-center rounded-full bg-fitgo-500 px-1 text-[9px] font-semibold leading-4 text-white">
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </>
  );
}
