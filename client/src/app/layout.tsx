import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Providers from './providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: { default: 'POS SaaS', template: '%s | POS SaaS' },
  description: 'Multi-tenant Point of Sale platform',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'POS' },
};

export const viewport: Viewport = {
  themeColor: '#0284c7',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning prevents React mismatch when the inline script
    // adds the 'dark' class before hydration.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply dark theme before first paint to avoid flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var t = localStorage.getItem('theme');
                if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.documentElement.classList.add('dark');
                }
              } catch(e) {}
            `,
          }}
        />
      </head>
      <body className={`${inter.className} bg-slate-50 dark:bg-slate-950 text-gray-900 dark:text-gray-100 antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
