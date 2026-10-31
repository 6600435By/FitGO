'use client';

import {
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import { cn } from '@/lib/utils';

export function OtpInput({
  length = 6,
  value,
  onChange,
  disabled,
  className,
  autoFocus,
}: {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  const setDigit = (index: number, digit: string) => {
    const next = digits.slice();
    next[index] = digit;
    onChange(next.join('').slice(0, length));
  };

  const handleChange = (index: number, e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) {
      setDigit(index, '');
      return;
    }
    if (raw.length > 1) {
      const chars = raw.slice(0, length - index).split('');
      const next = digits.slice();
      chars.forEach((ch, i) => {
        next[index + i] = ch;
      });
      onChange(next.join('').slice(0, length));
      const focusAt = Math.min(index + chars.length, length - 1);
      refs.current[focusAt]?.focus();
      return;
    }
    setDigit(index, raw);
    if (index < length - 1) refs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus();
      setDigit(index - 1, '');
    }
    if (e.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus();
    if (e.key === 'ArrowRight' && index < length - 1)
      refs.current[index + 1]?.focus();
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    onChange(pasted.padEnd(length, '').slice(0, length).replace(/ /g, ''));
    const focusAt = Math.min(pasted.length, length - 1);
    refs.current[focusAt]?.focus();
  };

  return (
    <div className={cn('flex justify-center gap-2', className)}>
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={length}
          value={digit}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          className={cn(
            'h-14 w-11 rounded-2xl border bg-ink-elevated text-center font-display text-xl font-semibold tabular-nums text-white outline-none transition',
            'border-white/10 focus:border-forma-500 focus:ring-2 focus:ring-forma-500/30',
            digit && 'border-forma-500/40',
          )}
          aria-label={`Цифра ${i + 1}`}
        />
      ))}
    </div>
  );
}
