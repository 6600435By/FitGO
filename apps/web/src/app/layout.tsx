import type { Metadata, Viewport } from 'next';
import { ClubThemeProvider } from '@/components/club-theme-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'FITGO — Фитнес-клуб',
  description: 'Абонемент, карта доступа, записи и тренировки',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'FITGO',
  },
};

export const viewport: Viewport = {
  themeColor: '#14b88a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>
        <ClubThemeProvider>{children}</ClubThemeProvider>
      </body>
    </html>
  );
}
