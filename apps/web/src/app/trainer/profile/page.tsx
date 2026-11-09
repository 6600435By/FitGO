'use client';

import { StaffProfilePage } from '@/components/staff-profile/staff-profile-page';
import { TrainerProfileForma } from '@/components/trainer-profile/trainer-profile-forma';
import { useTrainerUiV2 } from '@/components/trainer-shell/trainer-ui-v2';

export default function TrainerProfilePage() {
  const forma = useTrainerUiV2();
  if (forma) {
    return <TrainerProfileForma />;
  }
  return <StaffProfilePage title="Мой профиль" />;
}
