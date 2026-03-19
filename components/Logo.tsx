import Image from 'next/image';
import Link from 'next/link';

interface LogoProps {
  width?: number;
  height?: number;
  className?: string;
}

/** Matches riskmodels.net spec: logo left, h-16 sm:h-20 (64px / 80px) */
export default function Logo({ width = 180, height = 80, className = '' }: LogoProps) {
  return (
    <Link href="/" className={`flex items-center ${className}`} title="RiskModels - Back to home">
      <Image
        src="/transparent_logo.svg"
        alt="RiskModels"
        width={width}
        height={height}
        priority
        className="h-16 sm:h-20 w-auto min-w-[100px]"
      />
    </Link>
  );
}
