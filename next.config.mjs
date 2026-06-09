import createMDX from '@next/mdx';

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
  reactStrictMode: true,
  transpilePackages: ['@riskmodels/web'],
  /** Avoid broken vendor-chunk references for Supabase in server/prerender workers (Navbar pulls auth into every layout). */
  serverExternalPackages: ['@supabase/supabase-js', '@supabase/ssr', 'playwright-core'],
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
