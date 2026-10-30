'use client';

import { ChatInbox } from '@/components/chat/chat-inbox';

export default function ClientNotificationsPage() {
  return (
    <div className="space-y-3">
      <ChatInbox role="client" />
    </div>
  );
}
