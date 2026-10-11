import withPWAInit from '@ducanh2912/next-pwa';

const withPWA = withPWAInit({
  dest: 'public',
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: false, // we manage reconnect ourselves
  disable: process.env.NODE_ENV === 'development',
  workboxOptions: {
    // Precache the app shell so /pos loads with no network
    runtimeCaching: [
      {
        // API calls: network-first, fallback to nothing (offline handled by IndexedDB)
        urlPattern: /\/api\/v1\//,
        handler: 'NetworkOnly',
      },
    ],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output is only for the Docker image (which runs server.js).
  // Hosts that run `next start` (e.g. Render) need the regular output —
  // `next start` on a standalone build 500s with "reading 'clientModules'".
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
};

export default withPWA(nextConfig);