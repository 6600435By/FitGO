'use client';

import Link from 'next/link';
import { AdminThemeSettingRow } from '@/components/admin/admin-theme';

export default function AdminSettingsRedirectPage() {
  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h2 className="text-xl font-semibold text-white">Оформление кабинета</h2>
        <AdminThemeSettingRow />
      </div>
      <div className="card space-y-3">
        <h2 className="text-xl font-semibold text-white">Настройки клуба</h2>
        <p className="text-sm text-slate-400">
          Профиль клуба, брендинг и часы работы — в кабинете супер-админа /
          управляющего: «Настройки клуба». Админы редактируют график смен.
        </p>
        <Link href="/admin/staff-roster" className="btn-primary inline-flex w-fit">
          Открыть график смен
        </Link>
      </div>
    </div>
  );
}
