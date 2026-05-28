import Image from 'next/image';
import Link from 'next/link';

interface LogoProps {
  width?: number;
  height?: number;
  className?: string;
  /** Italic-serif sub-wordmark rendered next to the logo (matches riskmodels.net Workspace treatment). */
  subWord?: string;
}

/** Brand mark for the top nav. Scales from h-14 (mobile) to h-20 (lg+) to match the .net workspace masthead presence. */
export default function Logo({ width = 520, height = 200, className = '', subWord }: LogoProps) {
  return (
    <Link
      href="/"
      className={`flex shrink-0 items-center gap-3 sm:gap-4 md:gap-5 ${className}`}
      title="RiskModels — back to home"
    >
      <Image
        src="/transparent_logo.svg"
        alt="RiskModels"
        width={width}
        height={height}
        priority
        className="h-14 sm:h-16 md:h-[4.5rem] lg:h-20 w-auto object-contain object-left"
        style={{ width: 'auto' }}
      />
      {subWord ? (
        <span className="hidden items-center gap-3 font-serif italic tracking-tight text-zinc-300/90 sm:inline-flex sm:gap-4 md:gap-5 text-2xl sm:text-3xl md:text-4xl lg:text-[2.75rem]">
          <span aria-hidden="true" className="h-10 w-px bg-zinc-700 sm:h-12 md:h-14 lg:h-16" />
          {subWord}
        </span>
      ) : null}
    </Link>
  );
}
