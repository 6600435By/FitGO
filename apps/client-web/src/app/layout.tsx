import type { Metadata, Viewport } from 'next';
import { ClubThemeProvider } from '@/components/club-theme-provider';
import { FeaturesProvider } from '@/components/features-provider';
import { ToastProvider } from '@/components/forma/toast';
import './globals.css';

export const metadata: Metadata = {
  title: 'Forma — личный кабинет',
  description: 'Абонемент, запись и визиты фитнес-студии Forma',
  manifest: '/manifest.json',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Forma',
  },
};

export const viewport: Viewport = {
  themeColor: '#0B0B0C',
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
    <html lang="ru">
      <body className="font-sans">
        <FeaturesProvider>
          <ClubThemeProvider>
            <ToastProvider>{children}</ToastProvider>
          </ClubThemeProvider>
        </FeaturesProvider>
      </body>
    </html>
  );
}
