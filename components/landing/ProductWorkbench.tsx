import TerminalShowcase from '@/components/TerminalShowcase';
import HeroFeatureGrid from '@/components/HeroFeatureGrid';

/**
 * Unified glass workbench: live terminal + three feature columns share one max width (max-w-7xl).
 */
export default function ProductWorkbench() {
  return (
    <section className="relative z-[3] -mt-12 w-full bg-zinc-950 px-4 py-14 sm:-mt-14 sm:px-6 sm:py-16 lg:px-8 lg:py-16">
      <div className="mx-auto max-w-7xl min-w-0 rounded-2xl border border-white/10 bg-zinc-950/55 backdrop-blur-md shadow-[0_32px_90px_-28px_rgba(0,0,0,0.65)] ring-1 ring-white/[0.06]">
        <div className="px-4 py-4 sm:px-6 sm:py-5 lg:px-7 lg:py-6">
          <TerminalShowcase embedded />
          <div className="mt-3 border-t border-white/10 pt-3 sm:mt-4 sm:pt-4">
            <HeroFeatureGrid embedded />
          </div>
        </div>
      </div>
    </section>
  );
}
