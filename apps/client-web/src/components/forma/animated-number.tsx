'use client';

import { useEffect, useState } from 'react';
import { motion, useSpring, useTransform } from 'motion/react';
import { cn } from '@/lib/utils';

export function AnimatedNumber({
  value,
  className,
  decimals = 0,
}: {
  value: number;
  className?: string;
  decimals?: number;
}) {
  const spring = useSpring(0, { stiffness: 90, damping: 20 });
  const display = useTransform(spring, (v) =>
    decimals > 0 ? v.toFixed(decimals) : String(Math.round(v)),
  );
  const [text, setText] = useState(String(value));

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  useEffect(() => {
    const unsub = display.on('change', (v) => setText(v));
    return () => unsub();
  }, [display]);

  return (
    <motion.span className={cn('tabular-nums', className)}>{text}</motion.span>
  );
}
