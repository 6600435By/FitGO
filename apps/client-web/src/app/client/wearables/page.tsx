'use client';

import { ModuleGate } from '@/components/module-gate';
import { PageHeader } from '@/components/forma/page-header';

export default function ClientWearablesPage() {
  return (
    <ModuleGate module="wearables">
      <div className="space-y-4">
        <PageHeader
          title="Носимые устройства"
          subtitle="Apple Health и Google Fit — скоро"
        />
        <div className="card space-y-3 text-center">
          <p className="text-zinc-400">
            Интеграция ещё не подключена. Модуль выключен по умолчанию — включите
            в супер-админ → Модули, когда будет готов OAuth.
          </p>
        </div>
      </div>
    </ModuleGate>
  );
}
