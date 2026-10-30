'use client';

import { useState } from 'react';
import { SendClientClubMessage } from '@/components/admin/send-client-club-message';
import { ChatInbox } from '@/components/chat/chat-inbox';

export default function SuperAdminMessagesPage() {
  const [clientId, setClientId] = useState('');

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h2 className="text-xl font-semibold">Сообщения</h2>

      <section className="space-y-3">
        <h3 className="font-medium">Клиенту (push или SMS)</h3>
        <div className="card space-y-2">
          <label className="text-sm text-slate-400">ID клиента FitGO</label>
          <input
            className="input"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="cuid"
          />
        </div>
        {clientId.trim() ? (
          <SendClientClubMessage
            clientUserId={clientId.trim()}
            asSuperAdmin
          />
        ) : null}
      </section>

      <section className="space-y-3">
        <h3 className="font-medium">Команде</h3>
        <p className="text-sm text-slate-400">
          Личные и групповые чаты с сотрудниками.
        </p>
        <ChatInbox
          role="staff"
          scope="staff"
          allowStaffChat
          allowGroupChat
        />
      </section>
    </div>
  );
}
