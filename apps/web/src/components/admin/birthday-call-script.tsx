'use client';

import { formatBirthdayCallScript } from '@/lib/birthday-call-script';

export function BirthdayCallScript({
  firstName,
  middleName,
  title,
}: {
  firstName?: string | null;
  middleName?: string | null;
  title?: string | null;
}) {
  const text = formatBirthdayCallScript({ firstName, middleName, title });
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        Текст для звонка
      </p>
      <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-200">
        {text}
      </p>
    </div>
  );
}
