'use client';

import confetti from 'canvas-confetti';
import { useEffect, useRef } from 'react';
import { detectLadderStepUp } from '@/lib/trainer-motivation';

/** Fire confetti once when ladder percent steps up for this trainer. */
export function useLadderConfetti(
  userId: string | undefined,
  ladder: { percent: number; volumeCount: number } | null | undefined,
) {
  const fired = useRef(false);

  useEffect(() => {
    if (!userId || !ladder || fired.current) return;
    const stepped = detectLadderStepUp(userId, ladder);
    if (!stepped) return;
    fired.current = true;

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    void confetti({
      particleCount: 90,
      spread: 70,
      origin: { y: 0.35 },
      colors: ['#FFD000', '#FFFFFF', '#34D399'],
    });
  }, [userId, ladder?.percent, ladder?.volumeCount, ladder]);
}
