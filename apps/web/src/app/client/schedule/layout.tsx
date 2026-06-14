'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/client/schedule', label: 'Групповые', exact: true },
  { href: '/client/schedule/personal', label: 'Персональные', exact: false },
];

export default function ClientScheduleLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Расписание</h2>

      <div className="flex gap-2">
        {TABS.map((tab) => {
          const active = tab.exact
            ? pathname === tab.href
            : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'flex-1 rounded-full px-3 py-2 text-center text-sm',
                active
                  ? 'bg-fitgo-500 text-white'
                  : 'bg-slate-800 text-slate-400',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {children}
    </div>
  );
}
