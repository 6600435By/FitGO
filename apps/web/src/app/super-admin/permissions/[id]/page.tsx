'use client';

import {
  ADMIN_PERMISSION_LABELS,
  ADMIN_PERMISSION_PRESETS,
  AdminPermission,
} from '@fitgo/shared-types';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

const ALL = Object.values(AdminPermission);

export default function SuperAdminPermissionsPage() {
  const { id } = useParams<{ id: string }>();
  const [permissions, setPermissions] = useState<AdminPermission[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api.superAdminPermissions(token, id).then((data) => setPermissions(data.permissions));
  }, [id]);

  const toggle = (p: AdminPermission) => {
    setPermissions((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  const save = async () => {
    const token = getToken();
    if (!token) return;
    await api.superAdminSetPermissions(token, id, permissions);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const applyPreset = async (preset: 'reception' | 'marketing' | 'floor') => {
    const token = getToken();
    if (!token) return;
    const data = await api.superAdminApplyPreset(token, id, preset);
    setPermissions(data.permissions as AdminPermission[]);
  };

  return (
    <div className="space-y-4">
      <Link href="/super-admin/staff" className="text-sm text-fitgo-400">← Staff</Link>
      <h2 className="text-xl font-semibold">Права администратора</h2>

      <div className="flex flex-wrap gap-2">
        {Object.entries(ADMIN_PERMISSION_PRESETS).map(([key, preset]) => (
          <button
            key={key}
            onClick={() => applyPreset(key as 'reception' | 'marketing' | 'floor')}
            className="rounded-full bg-slate-800 px-3 py-1 text-xs"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <ul className="space-y-2">
        {ALL.map((p) => (
          <li key={p} className="card flex items-center justify-between">
            <span className="text-sm">{ADMIN_PERMISSION_LABELS[p]}</span>
            <input type="checkbox" checked={permissions.includes(p)} onChange={() => toggle(p)} />
          </li>
        ))}
      </ul>

      <button onClick={save} className="btn-primary w-full">
        {saved ? 'Сохранено' : 'Сохранить права'}
      </button>
    </div>
  );
}
