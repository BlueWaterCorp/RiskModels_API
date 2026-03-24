import Hero from '@/components/Hero';
import ProductWorkbench from '@/components/landing/ProductWorkbench';
import LandingLower from '@/components/landing/LandingLower';

export default function HomePage() {
  return (
    <div className="min-h-screen w-full max-w-[90rem] mx-auto overflow-x-hidden">
      <Hero />
      <ProductWorkbench />
      <LandingLower />
    </div>
  );
}
