'use client';

import { PageHeader } from '@fitgo/forma-ui';
import { StaffRosterCalendar } from '@/components/staff-roster/staff-roster-calendar';
import { useTrainerUiV2 } from '@/components/trainer-shell/trainer-ui-v2';

export default function TrainerStaffRosterPage() {
  const forma = useTrainerUiV2();

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
