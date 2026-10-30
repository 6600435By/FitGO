'use client';

import { Suspense } from 'react';
import ClientSpaSchedulePage from './spa-page-inner';

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
        </div>
      }
    >
      <ClientSpaSchedulePage />
    </Suspense>
  );
}
