import Image from 'next/image';
import Link from 'next/link';

interface LogoProps {
  width?: number;
  height?: number;
  className?: string;
  /** Italic-serif sub-wordmark rendered next to the logo (matches riskmodels.net Workspace treatment). */
  subWord?: string;
}

/** Matches riskmodels.net spec: logo left, h-16 sm:h-20 (64px / 80px). Optional italic-serif sub-wordmark on the right, separated by a thin vertical hairline. */
export default function Logo({ width = 180, height = 80, className = '', subWord }: LogoProps) {
  return (
    <Link
      href="/"
      className={`flex items-center gap-3 sm:gap-4 ${className}`}
      title="RiskModels — back to home"
    >
      <Image
        src="/transparent_logo.svg"
        alt="RiskModels"
        width={width}
        height={height}
        priority
        className="h-16 sm:h-20 w-auto min-w-[100px]"
        style={{ width: 'auto' }}
      />
      {subWord ? (
        <span className="hidden items-center gap-3 font-serif text-2xl italic tracking-tight text-zinc-400 sm:inline-flex sm:gap-4 md:text-3xl">
          <span aria-hidden="true" className="h-9 w-px bg-zinc-700 md:h-11" />
          {subWord}
        </span>
      ) : null}
    </Link>
  );
}
