import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Yaya Alanı İhlal Paneli',
    template: '%s · Yaya Paneli',
  },
  description:
    'Belediye personeli için yaya alanı ihlali inceleme, karar ve şehir analizi paneli.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b4a6f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <a href="#main" className="skip-link">
          İçeriğe geç
        </a>
        {children}
      </body>
    </html>
  );
}
