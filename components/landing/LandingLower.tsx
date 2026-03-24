import AgenticSection from '@/components/AgenticSection';
import UseCases from '@/components/UseCases';
import ComparisonTable from '@/components/ComparisonTable';
import TryFree from '@/components/TryFree';

/**
 * Lower landing stack with a deep, blurred blue radial mesh (barely perceptible on dark bg).
 */
export default function LandingLower() {
  return (
    <div className="relative isolate overflow-hidden bg-zinc-950">
      <div className="pointer-events-none absolute inset-0 -z-20 bg-zinc-950" aria-hidden />
      <div
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[min(140rem,260vh)] w-[min(125vw,105rem)] -translate-x-1/2 bg-[radial-gradient(ellipse_52%_36%_at_50%_0%,rgb(37_99_235/0.11),transparent_58%),radial-gradient(ellipse_40%_30%_at_78%_16%,rgb(30_64_175/0.09),transparent_52%),radial-gradient(ellipse_36%_28%_at_16%_28%,rgb(59_130_246/0.06),transparent_50%)] blur-[100px] opacity-[0.9]"
        aria-hidden
      />
      <div className="relative z-10">
        <AgenticSection />
        <div
          className="relative z-[2] flex justify-center py-0 pointer-events-none select-none"
          aria-hidden
        >
          <div className="h-[4.5rem] w-0 shrink-0 border-l border-dashed border-blue-500/40 [mask-image:linear-gradient(to_bottom,black_0%,black_50%,transparent_100%)] sm:h-[5.5rem]" />
        </div>
        <UseCases />
        <ComparisonTable />
        <TryFree />
      </div>
    </div>
  );
}
