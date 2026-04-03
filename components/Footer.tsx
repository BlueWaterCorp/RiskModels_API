import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="w-full border-t border-white/5 py-4 bg-zinc-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 text-center md:flex-row md:items-center md:justify-between md:text-left">
          <p className="text-xs text-zinc-500">
            &copy; {new Date().getFullYear()}{' '}
            <span className="text-zinc-300 font-semibold">Blue Water Macro Corp.</span>{' '}
            All rights reserved. RiskModels is a registered DBA of Blue Water Macro Corp.
          </p>

          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-zinc-400 md:justify-end">
            <a
              href="https://github.com/Cerebellum-Archive/RiskModels_API"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-100 transition-colors"
            >
              GitHub
            </a>
            <a
              href="mailto:service@riskmodels.app"
              className="hover:text-zinc-100 transition-colors"
            >
              Contact
            </a>
            <Link
              href="/docs/api"
              className="hover:text-zinc-100 transition-colors"
            >
              Documentation
            </Link>
            <a
              href="https://github.com/Cerebellum-Archive/RiskModels_API/blob/main/CONTRIBUTING.md"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-100 transition-colors"
            >
              Contribute
            </a>
            <Link
              href="/legal"
              className="hover:text-zinc-100 transition-colors"
            >
              Legal / Disclosures
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
