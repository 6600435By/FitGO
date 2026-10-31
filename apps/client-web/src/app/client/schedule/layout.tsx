'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, type ReactNode } from 'react';
import { SegmentedControl } from '@/components/forma/segmented-control';
import { PageHeader } from '@/components/forma/page-header';
import { useFeatures } from '@/components/features-provider';

type Tab = 'group' | 'personal' | 'spa';

const TAB_HREF: Record<Tab, string> = {
  group: '/client/schedule',
  personal: '/client/schedule/personal',
  spa: '/client/schedule/spa',
};

export default function ClientScheduleLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { isEnabled, loading } = useFeatures();

  const tabs = useMemo(() => {
    const list: Array<{ value: Tab; label: string }> = [];
    if (isEnabled('group_classes')) {
      list.push({ value: 'group', label: 'Группы' });
    }
    list.push({ value: 'personal', label: 'Персональные' });
    if (isEnabled('spa_booking')) {
      list.push({ value: 'spa', label: 'SPA' });
    }
    return list;
  }, [isEnabled]);

  const active: Tab = pathname.startsWith('/client/schedule/spa')
    ? 'spa'
    : pathname.startsWith('/client/schedule/personal')
      ? 'personal'
      : 'group';

  useEffect(() => {
    if (loading || tabs.length === 0) return;
    if (!tabs.some((t) => t.value === active)) {
      router.replace(TAB_HREF[tabs[0].value]);
    }
  }, [active, loading, router, tabs]);

  useEffect(() => {
    try {
      sessionStorage.setItem('forma:schedule-tab', active);
    } catch {
      /* ignore */
    }
  }, [active]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Расписание"
        subtitle="Запись на занятия студии Forma"
      />

      {tabs.length > 1 ? (
        <SegmentedControl
          layoutId="schedule-tabs"
          value={active}
          options={tabs}
          onChange={(value) => router.push(TAB_HREF[value])}
        />
      ) : null}

      {children}
    </div>
  );
}
