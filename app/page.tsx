import HeroDecompose from '@/components/landing/HeroDecompose';
import InstallPathCards from '@/components/landing/InstallPathCards';
import LivePlaygroundDemo from '@/components/landing/LivePlaygroundDemo';
import DeveloperPlaygroundSection from '@/components/landing/DeveloperPlaygroundSection';
import DecomposeWidget from '@/components/landing/DecomposeWidget';
import OneCallManySurfaces from '@/components/landing/OneCallManySurfaces';
import SdkVisualSystem from '@/components/landing/SdkVisualSystem';
import AgentLoopSection from '@/components/landing/AgentLoopSection';
import PricingApiFirst from '@/components/landing/PricingApiFirst';
import TrustCredibility from '@/components/landing/TrustCredibility';
import FinalCta from '@/components/landing/FinalCta';

export default function HomePage() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-[90rem] overflow-x-hidden">
      <HeroDecompose />
      <OneCallManySurfaces />
      <SdkVisualSystem />
      <AgentLoopSection />
      <div id="install-paths">
        <InstallPathCards />
      </div>
      <LivePlaygroundDemo />
      <DeveloperPlaygroundSection />
      <DecomposeWidget />
      <PricingApiFirst />
      <TrustCredibility />
      <FinalCta />
    </div>
  );
}
