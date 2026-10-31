'use client';

import { PageHeader } from '@/components/forma/page-header';
import { ChatInbox } from '@/components/chat/chat-inbox';
import { ModuleGate } from '@/components/module-gate';

export default function ClientNotificationsPage() {
  return (
    <ModuleGate module="messaging">
      <div className="space-y-3">
        <PageHeader
          title="Сообщения"
          subtitle="Чат с клубом и тренерами"
        />
        <ChatInbox
          role="client"
          className="!rounded-[1.75rem] !bg-ink-elevated/90 !ring-white/10"
        />
      </div>
    </ModuleGate>
  );
}
