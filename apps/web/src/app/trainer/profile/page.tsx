'use client';

import { useFeatures } from '@/components/features-provider';
import { StaffProfilePage } from '@/components/staff-profile/staff-profile-page';
import { TrainerProfileForma } from '@/components/trainer-profile/trainer-profile-forma';

export default function TrainerProfilePage() {
  const { isEnabled } = useFeatures();
  if (isEnabled('trainer_ui_v2')) {
    return <TrainerProfileForma />;
  }
  return <StaffProfilePage title="Мой профиль" />;
}
