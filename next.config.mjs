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
      { source: '/examples', destination: '/quickstart#code-examples', permanent: true },
      { source: '/api-docs', destination: '/api-docs.html', permanent: true },
      { source: '/documentation', destination: '/docs/api', permanent: true },
      { source: '/docs', destination: '/docs/api', permanent: true },
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
