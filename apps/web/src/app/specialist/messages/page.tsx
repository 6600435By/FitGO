'use client';

import { useState } from 'react';
import { ChatInbox } from '@/components/chat/chat-inbox';

type Tab = 'admin' | 'team';

export default function SpecialistMessagesPage() {
  const [tab, setTab] = useState<Tab>('admin');

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Сообщения</h2>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('admin')}
          className={`flex-1 rounded-full px-2 py-2 text-sm ${
            tab === 'admin'
              ? 'bg-fitgo-500 text-white'
              : 'bg-slate-800 text-slate-400'
          }`}
        >
          Админ
        </button>
        <button
          type="button"
          onClick={() => setTab('team')}
          className={`flex-1 rounded-full px-2 py-2 text-sm ${
            tab === 'team'
              ? 'bg-fitgo-500 text-white'
              : 'bg-slate-800 text-slate-400'
          }`}
        >
          Команда
        </button>
      </div>
      {tab === 'admin' ? (
        <ChatInbox
          key="admin"
          role="trainer"
          scope="admin"
          directThread
          allowStaffChat={false}
        />
      ) : (
        <ChatInbox key="team" role="trainer" scope="staff" allowStaffChat />
      )}
    </div>
  );
}
