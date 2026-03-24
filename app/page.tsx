import Hero from '@/components/Hero';
import HeroFeatureGrid from '@/components/HeroFeatureGrid';
import TryFree from '@/components/TryFree';
import { WhatYouCanDo } from '@/components/WhatYouCanDo';
import AgenticSection from '@/components/AgenticSection';
import UseCases from '@/components/UseCases';
import ComparisonTable from '@/components/ComparisonTable';
import TerminalShowcase from '@/components/TerminalShowcase';

export default function HomePage() {
  return (
    <div className="min-h-screen w-full max-w-[90rem] mx-auto">
      <Hero />
      <TerminalShowcase />
      <HeroFeatureGrid />
      <AgenticSection />
      <UseCases />
      <WhatYouCanDo />
      <ComparisonTable />
      <TryFree />
    </div>
  );
}
