'use client';

import type { ReactNode } from 'react';

/** Labelled field with slate-500 helper text. */
export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="text-slate-300">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

/** Nullable numeric input: empty string → null. */
export function NumInput({
  value,
  onChange,
  step,
  min,
  max,
  placeholder,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
}) {
  return (
    <input
      className="input"
      type="number"
      step={step}
      min={min}
      max={max}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') {
          onChange(null);
          return;
        }
        const n = Number(raw);
        onChange(Number.isFinite(n) ? n : null);
      }}
    />
  );
}

/** Money input: value in minor units, edits in major units. */
export function MoneyInput({
  valueMinor,
  onChange,
  placeholder,
}: {
  valueMinor: number | null;
  onChange: (minor: number | null) => void;
  placeholder?: string;
}) {
  return (
    <NumInput
      step={0.1}
      min={0}
      placeholder={placeholder}
      value={valueMinor == null ? null : valueMinor / 100}
      onChange={(v) => onChange(v == null ? null : Math.round(v * 100))}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: string;
}) {
  return (
    <label className="block text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-slate-400">{label}</span>
        <span className="font-medium text-slate-100">{display}</span>
      </div>
      <input
        className="mt-1 w-full accent-fitgo-500"
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function Badge({
  children,
  tone = 'slate',
  title,
}: {
  children: ReactNode;
  tone?: 'slate' | 'amber' | 'emerald' | 'rose' | 'fitgo';
  title?: string;
}) {
  const cls: Record<string, string> = {
    slate: 'bg-slate-800 text-slate-300',
    amber: 'bg-amber-500/10 text-amber-300',
    emerald: 'bg-emerald-500/10 text-emerald-300',
    rose: 'bg-rose-500/10 text-rose-300',
    fitgo: 'bg-fitgo-500/15 text-fitgo-400',
  };
  return (
    <span
      title={title}
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${cls[tone]}`}
    >
      {children}
    </span>
  );
}
