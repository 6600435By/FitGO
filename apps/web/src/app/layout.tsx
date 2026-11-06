import type { Metadata, Viewport } from 'next';
import { Manrope, Unbounded } from 'next/font/google';
import { ClubThemeProvider } from '@/components/club-theme-provider';
import { FeaturesProvider } from '@/components/features-provider';
import './globals.css';

const formaDisplay = Unbounded({
  subsets: ['latin', 'cyrillic'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-forma-display',
  display: 'swap',
});

const formaSans = Manrope({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-forma-sans',
  display: 'swap',
});

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
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={`${formaDisplay.variable} ${formaSans.variable}`}>
      <body>
        <FeaturesProvider>
          <ClubThemeProvider>{children}</ClubThemeProvider>
        </FeaturesProvider>
      </body>
    </html>
  );
}
