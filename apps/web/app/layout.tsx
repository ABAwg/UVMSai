import type { Metadata, Viewport } from 'next';
import 'katex/dist/katex.min.css';
import './globals.css';
import Providers from './providers';
import packageJson from '../package.json';

export const metadata: Metadata = {
  title: { default: `UVMS AI · v${packageJson.version}`, template: '%s · UVMS AI' },
  description: 'Think. Create. Do together.',
  applicationName: 'UVMS AI',
  manifest: '/manifest.webmanifest',
  icons: { icon: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { url: '/icon-512.png', sizes: '512x512', type: 'image/png' }] },
};

export const viewport: Viewport = { themeColor: '#07110F', colorScheme: 'dark' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
