'use client';

import { ChatInbox } from '@/components/chat/chat-inbox';

export default function SuperAdminMessagesPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h2 className="text-xl font-semibold">Сообщения команде</h2>
      <p className="text-sm text-slate-400">
        Личные чаты с сотрудниками клуба. Нажмите +, чтобы выбрать адресата.
      </p>
      <ChatInbox role="staff" scope="staff" allowStaffChat />
    </div>
  );
}
