import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  images: { unoptimized: true },
  outputFileTracingExcludes: {
    '/*': [
      'node_modules/sharp/**/*',
      'node_modules/@img/**/*',
      '.env*',
      'Open.env',
      '**/*.env',
      '**/*.env.*',
      '**/.env*',
      '.cache/**/*',
      '.data/**/*',
      'backups/**/*',
      'dist/**/*',
      '.git/**/*',
    ],
  },
  outputFileTracingIncludes: {
    '/*': [
      'db/migrations/*.sql',
      'node_modules/next/dist/compiled/next-server/app-route-turbo.runtime.prod.js',
    ],
  },
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline'" +
              (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '') +
              "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
};
export default config;
