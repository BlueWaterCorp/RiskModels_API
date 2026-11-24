import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'API reference',
  description:
    'Every RiskModels API endpoint with its parameters, response fields, price per request and an example.',
  alternates: { canonical: '/api-reference' },
};

export default function ApiReferenceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
