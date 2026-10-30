'use client';

import { ModuleGate } from '@/components/module-gate';

export default function ClientWearablesPage() {
  return (
    <ModuleGate module="wearables">
      <div className="card space-y-3 text-center">
        <h2 className="text-xl font-semibold">Носимые устройства</h2>
        <p className="text-slate-400">
          Интеграция Apple Health / Google Fit ещё не подключена. Модуль выключен
          по умолчанию — включите в супер-админ → Модули, когда будет готов OAuth.
        </p>
      </div>
    </ModuleGate>
  );
}
