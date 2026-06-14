'use client';

import type { StaffAuditLogItem } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

export default function SuperAdminAuditPage() {
  const [logs, setLogs] = useState<StaffAuditLogItem[]>([]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api.superAdminAuditLog(token).then(setLogs);
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Журнал действий</h2>
      <ul className="space-y-2">
        {logs.map((log) => (
          <li key={log.id} className="card text-sm">
            <p className="font-medium">{log.action}</p>
            <p className="text-slate-400">{log.actorName} · {formatDateTime(log.createdAt)}</p>
            {log.targetId && <p className="text-xs text-slate-500">target: {log.targetId}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
