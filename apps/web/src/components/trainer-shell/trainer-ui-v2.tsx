'use client';

import {
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import { useFeatures } from '@/components/features-provider';

const TrainerUiV2Context = createContext<boolean | null>(null);

/** Layout sets this when TrainerShell is mounted — pages must not fall back to legacy UI. */
export function TrainerUiV2Provider({
  value,
  children,
}: {
  value: boolean;
  children: ReactNode;
}) {
  return (
    <TrainerUiV2Context.Provider value={value}>
      {children}
    </TrainerUiV2Context.Provider>
  );
}

/** Prefer shell context so tab navigations never flash the old cabinet. */
export function useTrainerUiV2(): boolean {
  const fromShell = useContext(TrainerUiV2Context);
  const { isEnabled } = useFeatures();
  if (fromShell != null) return fromShell;
  return isEnabled('trainer_ui_v2');
}
