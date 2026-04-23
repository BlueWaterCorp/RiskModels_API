import HeroDecompose from '@/components/landing/HeroDecompose';
import LivePlaygroundDemo from '@/components/landing/LivePlaygroundDemo';
import DeveloperPlaygroundSection from '@/components/landing/DeveloperPlaygroundSection';
import DecomposeWidget from '@/components/landing/DecomposeWidget';
import WhyThisExists from '@/components/landing/WhyThisExists';
import OneFunction from '@/components/landing/OneFunction';
import BuiltForAgents from '@/components/landing/BuiltForAgents';
import CoreInsightFourBets from '@/components/landing/CoreInsightFourBets';
import NvdaVsAaplHook from '@/components/landing/NvdaVsAaplHook';
import UseCases from '@/components/UseCases';
import PricingApiFirst from '@/components/landing/PricingApiFirst';
import TrustCredibility from '@/components/landing/TrustCredibility';
import TerminalShowcase from '@/components/TerminalShowcase';
import FinalCta from '@/components/landing/FinalCta';

export default function HomePage() {
  return (
    <div className="min-h-screen w-full max-w-[90rem] mx-auto overflow-x-hidden">
      <HeroDecompose />
      <LivePlaygroundDemo />
      <DeveloperPlaygroundSection />
      <DecomposeWidget />
      <WhyThisExists />
      <OneFunction />
      <BuiltForAgents />
      <CoreInsightFourBets />
      <NvdaVsAaplHook />
      <UseCases />
      <PricingApiFirst />
      <TrustCredibility />
      <TerminalShowcase />
      <FinalCta />
    </div>
  );
}
