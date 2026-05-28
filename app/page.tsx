import HeroLanding from '@/components/landing/HeroLanding';
import WorkedExampleHero from '@/components/landing/WorkedExampleHero';
import AudienceCards from '@/components/landing/AudienceCards';
import TerminalShowcase from '@/components/TerminalShowcase';
import ResearchProof from '@/components/landing/ResearchProof';
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

// Seven legacy mid-page sections overlap with the new spine
// (worked-example → audience cards → research proof). Default off in
// production; flip locally with NEXT_PUBLIC_SHOW_LEGACY_SECTIONS=true to A/B them.
const SHOW_LEGACY_SECTIONS = process.env.NEXT_PUBLIC_SHOW_LEGACY_SECTIONS === 'true';

export default function HomePage() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-[90rem] overflow-x-hidden">
      <HeroLanding />
      <WorkedExampleHero />
      <AudienceCards />
      <TerminalShowcase />
      <ResearchProof />
      {SHOW_LEGACY_SECTIONS && (
        <>
          <FailureContrast />
          <RiskWalkthroughWithToggle />
          <BridgeSection />
          <PortfolioConcentration />
          <WhyThisMatters />
          <OneCallManySurfaces />
          <AgentLoopSection />
        </>
      )}
      <PricingApiFirst />
      <TrustCredibility />
      <FinalCta />
    </div>
  );
}
