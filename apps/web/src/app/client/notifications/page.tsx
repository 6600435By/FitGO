'use client';

import { ChatInbox } from '@/components/chat/chat-inbox';

export default function ClientNotificationsPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Чат</h2>
      <p className="text-sm text-slate-400">
        Переписка с администрацией клуба и тренерами
      </p>
      <ChatInbox role="client" />
    </div>
  );
}
