import HeroLanding from '@/components/landing/HeroLanding';
import TerminalShowcase from '@/components/TerminalShowcase';
import FailureContrast from '@/components/landing/FailureContrast';
import RiskWalkthroughWithToggle from '@/components/landing/RiskWalkthroughWithToggle';
import BridgeSection from '@/components/landing/BridgeSection';
import PortfolioConcentration from '@/components/landing/PortfolioConcentration';
import WhyThisMatters from '@/components/landing/WhyThisMatters';
import OneCallManySurfaces from '@/components/landing/OneCallManySurfaces';
import AgentLoopSection from '@/components/landing/AgentLoopSection';
import PricingApiFirst from '@/components/landing/PricingApiFirst';
import TrustCredibility from '@/components/landing/TrustCredibility';
import FinalCta from '@/components/landing/FinalCta';

export default function HomePage() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-[90rem] overflow-x-hidden">
      <HeroLanding />
      <TerminalShowcase />
      <FailureContrast />
      <RiskWalkthroughWithToggle />
      <BridgeSection />
      <PortfolioConcentration />
      <WhyThisMatters />
      <OneCallManySurfaces />
      <AgentLoopSection />
      <PricingApiFirst />
      <TrustCredibility />
      <FinalCta />
    </div>
  );
}
