'use client';

const STORAGE_KEY = 'fitgo_analytics_show_pay';

export function readPayVisibility(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writePayVisibility(v: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function PayVisibilityToggle({
  show,
  onChange,
}: {
  show: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
      <input
        type="checkbox"
        checked={show}
        onChange={(e) => {
          writePayVisibility(e.target.checked);
          onChange(e.target.checked);
        }}
        className="rounded border-slate-600"
      />
      Показать ЗП / аванс
    </label>
  );
}
