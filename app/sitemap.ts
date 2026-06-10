import type { MetadataRoute } from 'next';
import { CANONICAL_SITE_URL } from '@/lib/constants';
import { getAllDocSlugs } from '@/lib/mdx';

/**
 * Public sitemap. Covers the marketing + docs surface only — auth/account/oauth,
 * the print render-snapshot routes, and the per-ticker dynamic pages are
 * intentionally excluded (private, non-indexable, or unbounded). Docs pages are
 * enumerated from content/docs so new MDX files appear automatically.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = CANONICAL_SITE_URL;
  const now = new Date();

  // [path, priority] — changeFrequency/lastModified shared below.
  const staticRoutes: Array<[string, number]> = [
    ['/', 1.0],
    ['/compare/barra-axioma', 0.8],
    ['/pricing', 0.8],
    ['/docs', 0.8],
    ['/installation', 0.7],
    ['/api-reference', 0.7],
    ['/for-agents', 0.7],
    ['/cli', 0.6],
    ['/snapshots', 0.6],
    ['/legal', 0.3],
  ];

  const staticEntries: MetadataRoute.Sitemap = staticRoutes.map(([path, priority]) => ({
    url: `${base}${path}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority,
  }));

  const docEntries: MetadataRoute.Sitemap = getAllDocSlugs().map((slug) => ({
    url: `${base}/docs/${slug}`,
    lastModified: now,
    changeFrequency: 'monthly',
    priority: 0.6,
  }));

  return [...staticEntries, ...docEntries];
}
