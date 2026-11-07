'use client';

import { PageHeader } from '@fitgo/forma-ui';
import { useFeatures } from '@/components/features-provider';
import { StaffRosterCalendar } from '@/components/staff-roster/staff-roster-calendar';

export default function TrainerStaffRosterPage() {
  const { isEnabled } = useFeatures();
  const forma = isEnabled('trainer_ui_v2');

  return (
    <div className={forma ? 'mx-auto max-w-5xl space-y-3' : undefined}>
      {forma ? (
        <PageHeader
          title="Смены"
          subtitle="Календарь месяца · итог часов считается по опубликованному графику"
        />
      ) : null}
      <StaffRosterCalendar
        mode="trainer"
        showMotivation={forma}
        hideTitle={forma}
      />
    </div>
  );
}
