'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

const pulseTransition = {
  duration: 3,
  repeat: Infinity,
  ease: 'easeInOut' as const,
};

export function HeroGetStartedPulse() {
  return (
    <motion.div
      className="inline-flex rounded-lg will-change-transform"
      animate={{
        scale: [1, 1.02, 1],
        // boxShadow animates reliably across browsers; animating `filter` often breaks in dev / WebKit.
        boxShadow: [
          '0 10px 15px rgb(0 0 0 / 0.15), 0 0 0 transparent',
          '0 14px 28px rgb(0 0 0 / 0.22), 0 0 28px rgb(59 130 246 / 0.38)',
          '0 10px 15px rgb(0 0 0 / 0.15), 0 0 0 transparent',
        ],
      }}
      transition={pulseTransition}
    >
      <Link
        href="/pricing"
        className="group flex items-center gap-2 rounded-lg bg-primary px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90 hover:shadow-primary/30"
      >
        Get Started
        <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
      </Link>
    </motion.div>
  );
}
