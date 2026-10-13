import type { Metadata, Viewport } from 'next';
import { ClubThemeProvider } from '@/components/club-theme-provider';
import { FeaturesProvider } from '@/components/features-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'FITGO — Фитнес-клуб',
  description: 'Абонемент, карта доступа, записи и тренировки',
  manifest: '/manifest.json',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
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
        <FeaturesProvider>
          <ClubThemeProvider>{children}</ClubThemeProvider>
        </FeaturesProvider>
      </body>
    </html>
  );
}
