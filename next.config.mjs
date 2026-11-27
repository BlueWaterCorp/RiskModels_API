import createMDX from '@next/mdx';

// Full policy, sent as Report-Only until the sign-in, checkout and connector
// flows have run against it with zero reports. 'unsafe-inline' covers the tag
// and theme bootstrap scripts; a nonce would make every page render per request.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://googleads.g.doubleclick.net https://www.googleadservices.com https://challenges.cloudflare.com https://*.posthog.com https://js.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' data: https://*.supabase.co wss://*.supabase.co https://*.posthog.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://*.doubleclick.net https://www.google.com https://www.googleadservices.com https://pagead2.googlesyndication.com https://challenges.cloudflare.com",
  "frame-src 'self' https://challenges.cloudflare.com https://www.googletagmanager.com https://td.doubleclick.net https://js.stripe.com https://checkout.stripe.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  'report-uri /api/csp-report',
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
  reactStrictMode: true,
  transpilePackages: ['@riskmodels/web'],
  /** Avoid broken vendor-chunk references for Supabase in server/prerender workers (Navbar pulls auth into every layout). */
  serverExternalPackages: ['@supabase/supabase-js', '@supabase/ssr', 'playwright-core'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
          // Enforced: the site may be framed only by itself.
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // Observed, not yet enforced: violations are posted to /api/csp-report.
          // (Development bundles use eval, which the policy would report on every page.)
          ...(process.env.NODE_ENV === 'production'
            ? [{ key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY }]
            : []),
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: '/get-api-key',
        destination: '/get-key',
        permanent: true,
      },
      { source: '/quickstart', destination: '/installation', permanent: true },
      { source: '/examples', destination: '/installation', permanent: true },
      { source: '/api-docs', destination: '/api-docs.html', permanent: true },
      { source: '/documentation', destination: '/docs', permanent: true },
      // Only one comparison page today; bare /compare points at it so a trimmed URL doesn't 404.
      { source: '/compare', destination: '/compare/barra-axioma', permanent: false },
      // Stale README / SDK wiki_uri path — canonical methodology is /docs/methodology.
      {
        source: '/docs/methodology/erm3-l3',
        destination: '/docs/methodology',
        permanent: true,
      },
      // Stale /docs/python-sdk links (api-reference, llms.txt, key-issued email) — SDK onboarding is /installation.
      {
        source: '/docs/python-sdk',
        destination: '/installation',
        permanent: true,
      },
      // Directory listings expect /terms; the terms and disclosures live at /legal.
      {
        source: '/terms',
        destination: '/legal',
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/snapshots/:file*',
        destination:
          'https://storage.googleapis.com/rm_api_public/snapshot/:file*',
      },
    ];
  },
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
    };
    // lib/mcp is compiled by Next and by the NodeNext stdio package. The stdio
    // package requires a .js specifier; webpack must resolve that to the .ts source.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },
};

const withMDX = createMDX({
  options: {
    remarkPlugins: [],
    rehypePlugins: [],
  },
});

export default withMDX(nextConfig);
