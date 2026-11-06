'use client';

import type { ReactNode } from 'react';
import { ClientChannelRedirect } from '@/app/client/client-channel-redirect';

/**
 * Client UI lives on lk.ffs.by (`apps/client-web`).
 * Staff app (app.ffs.by) only redirects legacy /client bookmarks.
 */
export default function ClientLayout({ children: _children }: { children: ReactNode }) {
  return <ClientChannelRedirect />;
}
