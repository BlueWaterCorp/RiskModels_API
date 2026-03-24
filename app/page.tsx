import Hero from '@/components/Hero';
import TryFree from '@/components/TryFree';
import { WhatYouCanDo } from '@/components/WhatYouCanDo';
import AgenticSection from '@/components/AgenticSection';
import UseCases from '@/components/UseCases';
import ComparisonTable from '@/components/ComparisonTable';

export default function HomePage() {
  return (
    <main className="min-h-screen">
      <Hero />
      <AgenticSection />
      <UseCases />
      <WhatYouCanDo />
      <ComparisonTable />
      <TryFree />
    </main>
  );
}
