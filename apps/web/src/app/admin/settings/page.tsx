'use client';

import Link from 'next/link';

export default function AdminSettingsRedirectPage() {
  return (
    <div className="card space-y-3">
      <h2 className="text-xl font-semibold text-white">Настройки клуба</h2>
      <p className="text-sm text-slate-400">
        Профиль клуба, брендинг и часы работы перенесены в кабинет супер-админа:
        «Настройки клуба». Админы редактируют только график смен.
      </p>
      <Link href="/admin/staff-roster" className="btn-primary inline-flex w-fit">
        Открыть график смен
      </Link>
    </div>
  );
}
