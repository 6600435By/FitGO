'use client';

import { ChatInbox } from '@/components/chat/chat-inbox';

export default function SpecialistMessagesPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Сообщения</h2>
      <p className="text-sm text-slate-400">Чат с администрацией клуба</p>
      <ChatInbox key="admin" role="trainer" scope="admin" directThread />
    </div>
  );
}
