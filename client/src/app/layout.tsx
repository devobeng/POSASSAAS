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
    // removes the 'dark' class (light preference) before hydration.
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Dark is the default — <html> is server-rendered with class="dark"
            so it's dark from the very first byte. Only an explicit 'light'
            choice (saved by the Topbar toggle) removes it, before first paint. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if (localStorage.getItem('theme') === 'light') {
                  document.documentElement.classList.remove('dark');
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
