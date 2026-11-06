'use client';

import { EmptyState, PageHeader } from '@fitgo/forma-ui';
import { Wallet } from 'lucide-react';

/**
 * Placeholder for Логика 4 («Тренер клуб» ledger). Nav entry ships with shell.
 */
export default function TrainerMyPaymentsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Мои оплаты"
        subtitle="Личный учёт пакетов и заработка"
      />
      <EmptyState
        icon={<Wallet className="h-8 w-8 text-forma-400" />}
        title="Скоро здесь"
        description="Личные пакеты, оплаты клиентов и заработок появятся в следующем проходе (логика «Тренер клуб»)."
      />
    </div>
  );
}
