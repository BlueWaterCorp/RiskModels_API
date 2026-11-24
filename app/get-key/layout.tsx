import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Get an API key',
  description:
    'Sign in to receive a RiskModels API key with $20 of credit and a first request to paste into a terminal. No card needed.',
  alternates: { canonical: '/get-key' },
};

export default function GetKeyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
