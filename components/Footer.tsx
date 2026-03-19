import Image from 'next/image';
import Link from 'next/link';
import { Github, Mail } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="w-full border-t border-zinc-800 py-16 bg-zinc-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Top row */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <Image
              src="/transparent_logo.svg"
              alt="RiskModels"
              width={32}
              height={32}
              className="h-8 w-auto"
            />
            <span className="font-semibold text-zinc-100 tracking-tight">
              RiskModels API
            </span>
          </div>

          {/* Footer nav */}
          <nav className="flex flex-wrap items-center justify-center gap-6 text-sm">
            <a
              href="https://github.com/Cerebellum-Archive/RiskModels_API"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              <Github size={16} />
              GitHub
            </a>
            <a
              href="mailto:contact@riskmodels.net"
              className="flex items-center gap-2 text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              <Mail size={16} />
              Contact
            </a>
            <Link
              href="/docs/api"
              className="text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              Documentation
            </Link>
            <a
              href="https://github.com/Cerebellum-Archive/RiskModels_API/blob/main/CONTRIBUTING.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              Contribute
            </a>
          </nav>
        </div>

        {/* Legal */}
        <div className="mt-12 pt-8 border-t border-zinc-800">
          <div className="text-center space-y-3">
            <p className="text-xs text-zinc-500">
              © {new Date().getFullYear()}{' '}
              <span className="text-zinc-300 font-semibold">
                Blue Water Macro Corp
              </span>
              . All rights reserved.
            </p>
            <p className="text-xs text-zinc-500">
              RiskModels is a registered DBA of Blue Water Macro Corp.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
