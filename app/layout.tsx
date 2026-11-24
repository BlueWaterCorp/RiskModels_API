import type { Metadata } from 'next';
import { Inter, IBM_Plex_Mono, Newsreader } from 'next/font/google';
import 'katex/dist/katex.min.css';
import '@/styles/globals.css';
import Footer from '@/components/Footer';
import { SiteChrome } from '@/components/SiteChrome';
import { GoogleAdsTag } from '@/components/GoogleAdsTag';
import { GoogleTagManager, GoogleTagManagerNoScript } from '@/components/GoogleTagManager';
import { FEED_SECRET_STASH_SCRIPT } from '@/lib/feed-url-secrets';
import { CANONICAL_SITE_URL } from '@/lib/constants';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

const newsreader = Newsreader({
  subsets: ['latin'],
  variable: '--font-newsreader',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  // Resolve relative metadata URLs (canonical, og) against the canonical .app domain,
  // not the request host — the app also answers on .net, and a per-host canonical would
  // split SEO signal. See CANONICAL_SITE_URL in lib/constants.
  metadataBase: new URL(CANONICAL_SITE_URL),
  title: {
    default: 'RiskModels API — US equity risk decomposition and ETF hedge ratios',
    template: '%s | RiskModels API',
  },
  description:
    'Map any US equity across market, sector, subsector, and residual risk — with model-derived ETF hedge ratios for the systematic layers in one API call. ~3,000 US equities, daily hedge-ratio history from 2010.',
  keywords: ['API', 'risk models', 'equity risk', 'hedge ratios', 'factor analysis', 'quantitative finance', 'AI agents', 'MCP', 'model context protocol', 'OpenAPI', 'ETF hedge', 'factor decomposition', 'quant finance API'],
  authors: [{ name: 'Blue Water Macro Corp' }],
  creator: 'Blue Water Macro Corp',
  publisher: 'Blue Water Macro Corp',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://riskmodels.app',
    title: 'RiskModels API — US equity risk decomposition and ETF hedge ratios',
    description:
      'Map any US equity across market, sector, subsector, and residual risk — with model-derived ETF hedge ratios for the systematic layers in one API call. ~3,000 US equities, daily hedge-ratio history from 2010.',
    siteName: 'RiskModels API',
    images: [{
      url: 'https://riskmodels.app/og-image.png',
      width: 1200,
      height: 630,
      alt: 'RiskModels API',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RiskModels API',
    description:
      'Map any US equity across four legible risk layers. Model-derived ETF hedge ratios in one API call.',
    images: ['https://riskmodels.app/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
  },
};

// Print templates under /render-snapshot were written against a bare document:
// drop the site theme class before first paint there. The layout reads no request
// headers, so public pages stay cacheable; SiteChrome picks the frame from the path.
const PRINT_DOCUMENT_SCRIPT =
  "if(location.pathname.indexOf('/render-snapshot')===0){document.documentElement.className='';document.documentElement.style.background='white';}";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PRINT_DOCUMENT_SCRIPT }} />
        {/* Before any tag: moves feed-link secrets (token, inbox) out of the URL (lib/feed-url-secrets.ts). */}
        <script dangerouslySetInnerHTML={{ __html: FEED_SECRET_STASH_SCRIPT }} />
        {/* Google Tag Manager: as high in <head> as possible per GTM install guidance */}
        <GoogleTagManager />
        {/* Agent discovery: a bare fetch of riskmodels.app self-routes an AI agent to the
            machine-readable entry points, so a human only ever has to say "riskmodels.app"
            (never a path). Humans get the same pointer as a visible link in the Footer. */}
        <link rel="alternate" type="text/plain" href="/llms.txt" title="RiskModels for AI agents (llms.txt)" />
        <link rel="alternate" type="application/json" href="/.well-known/agent-manifest.json" title="RiskModels agent manifest" />
        {/* Google tag: last in <head>, just before </head> (see GoogleAdsTag) */}
        <GoogleAdsTag />
      </head>
      <body className={`${inter.className} ${inter.variable} ${newsreader.variable} ${plexMono.variable}`}>
        <GoogleTagManagerNoScript />
        {/* No Suspense boundary above the page: one here lets the response start with
            status 200 before a page can answer notFound(). */}
        <SiteChrome footer={<Footer />}>{children}</SiteChrome>
      </body>
    </html>
  );
}
