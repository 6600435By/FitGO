'use client';

import type { ProductModuleKey } from '@fitgo/shared-types';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useFeatures } from '@/components/features-provider';

export function ModuleGate({
  module,
  children,
  fallbackHref = '/client',
}: {
  module: ProductModuleKey;
  children: ReactNode;
  fallbackHref?: string;
}) {
  const { loading, isEnabled } = useFeatures();

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  if (!isEnabled(module)) {
    return (
      <div className="card space-y-3 text-center">
        <p className="text-lg font-semibold">Раздел скоро</p>
        <p className="text-sm text-slate-400">
          Этот модуль пока выключен на стенде. Загляните позже или спросите у клуба.
        </p>
        <Link href={fallbackHref} className="btn-primary inline-block">
          На главную
        </Link>
      </div>
    );
  }

  return children;
}
