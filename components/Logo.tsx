import Link from 'next/link';
import { LOCKUP_SVG } from '@/components/brand/lockup-svg';

interface LogoProps {
  className?: string;
  /** Italic-serif sub-wordmark beside the lockup, as on the research site. */
  subWord?: string;
}

/** Header lockup. The wordmark follows the text color: navy on paper, white on the dark field. */
export default function Logo({ className = '', subWord }: LogoProps) {
  return (
    <Link
      href="/"
      className={`flex min-w-0 shrink-0 items-center gap-2.5 ${className}`}
      aria-label="RiskModels API home"
    >
      <span
        aria-hidden="true"
        className="block h-12 shrink-0 text-[#002a5e] dark:text-white sm:h-14 [&>svg]:block [&>svg]:h-full [&>svg]:w-auto"
        dangerouslySetInnerHTML={{ __html: LOCKUP_SVG }}
      />
      {subWord ? (
        <span className="hidden items-center gap-2 font-serif text-base italic tracking-tight text-ink-muted sm:inline-flex">
          <span aria-hidden="true" className="h-5 w-px bg-rule" />
          {subWord}
        </span>
      ) : null}
    </Link>
  );
}
