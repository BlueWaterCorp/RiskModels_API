import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import 'katex/dist/katex.min.css';
import '@/styles/globals.css';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import ThemeByPath from '@/components/ThemeByPath';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    default: 'RiskModels API — Precision Equity Risk Intelligence',
    template: '%s | RiskModels API',
  },
  description: 'Institutional-grade equity risk analysis API. Daily factor decompositions, hedge ratios, and risk attribution for ~3,000 US equities. AI-agent ready with historical data back to 2006.',
  keywords: ['API', 'risk models', 'equity risk', 'hedge ratios', 'factor analysis', 'quantitative finance', 'AI agents'],
  authors: [{ name: 'Blue Water Macro Corp' }],
  creator: 'Blue Water Macro Corp',
  publisher: 'Blue Water Macro Corp',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://riskmodels.app',
    title: 'RiskModels API — Precision Equity Risk Intelligence',
    description: 'Institutional-grade equity risk analysis API for developers and AI agents',
    siteName: 'RiskModels API',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RiskModels API',
    description: 'Institutional-grade equity risk analysis API',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeByPath>
          <div className="flex flex-col min-h-screen">
            <Navbar />
            <main className="flex-1 pt-16">
              {children}
            </main>
            <Footer />
          </div>
        </ThemeByPath>
      </body>
    </html>
  );
}
