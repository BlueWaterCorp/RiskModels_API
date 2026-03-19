import Hero from '@/components/Hero';
import TryFree from '@/components/TryFree';
import { WhatYouCanDo } from '@/components/WhatYouCanDo';

export default function HomePage() {
  return (
    <main className="min-h-screen">
      <Hero />
      <WhatYouCanDo />
      <TryFree />
    </main>
  );
}
