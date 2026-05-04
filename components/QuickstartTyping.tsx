'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

type TypingStep = { command: string; outcome: string };

const STEPS: TypingStep[] = [
  { command: 'python3 -m pip install "riskmodels-py>=0.3.4"', outcome: 'installs the SDK' },
  { command: 'riskmodels decompose NVDA',                    outcome: 'returns L3 + hedge ratios' },
  { command: 'curl -X POST /decompose',                      outcome: 'same payload over HTTP' },
  { command: 'import { decompose } from "riskmodels"',       outcome: 'TypeScript SDK, same surface' },
  { command: '"Why did NVDA move?"',                         outcome: 'agent → exposures + hedge ratios' },
];

const TYPE_MS = 38;
const HOLD_MS = 900;
const ERASE_MS = 220;
const CURSOR_BLINK_MS = 530;

const LONGEST_STEP =
  STEPS.reduce((a, b) => (a.command.length >= b.command.length ? a : b));

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export default function QuickstartTyping({ className }: { className?: string }) {
  const [reduced, setReduced] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [typed, setTyped] = useState('');
  const [cursorOn, setCursorOn] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setReduced(prefersReducedMotion());
  }, []);

  useEffect(() => {
    if (reduced) return;

    const cursor = window.setInterval(() => setCursorOn((v) => !v), CURSOR_BLINK_MS);
    return () => window.clearInterval(cursor);
  }, [reduced]);

  useEffect(() => {
    if (reduced) return;

    const command = STEPS[stepIdx].command;
    let i = 0;

    const type = () => {
      if (i <= command.length) {
        setTyped(command.slice(0, i));
        i += 1;
        timerRef.current = setTimeout(type, TYPE_MS);
      } else {
        timerRef.current = setTimeout(erase, HOLD_MS);
      }
    };

    const erase = () => {
      timerRef.current = setTimeout(() => {
        setTyped('');
        setStepIdx((idx) => (idx + 1) % STEPS.length);
      }, ERASE_MS);
    };

    type();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [stepIdx, reduced]);

  const step = STEPS[stepIdx];

  if (reduced) {
    return (
      <div className={cn('font-mono text-base leading-relaxed sm:text-lg', className)}>
        <div className="overflow-hidden whitespace-nowrap text-zinc-100">
          <span className="text-emerald-400">{'> '}</span>
          {LONGEST_STEP.command}
        </div>
        <div className="mt-2 overflow-hidden whitespace-nowrap pl-4 text-zinc-300">
          {LONGEST_STEP.outcome}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn('font-mono text-base leading-relaxed sm:text-lg', className)}
      role="presentation"
      aria-hidden="true"
    >
      <div className="overflow-hidden whitespace-nowrap text-zinc-100">
        <span className="text-emerald-400">{'> '}</span>
        {typed}
        <span
          className={cn(
            'ml-0.5 inline-block h-[1em] w-[0.55ch] translate-y-[2px] bg-zinc-100 align-middle',
            cursorOn ? 'opacity-100' : 'opacity-0',
          )}
        />
      </div>
      <div className="mt-2 overflow-hidden whitespace-nowrap pl-4 text-zinc-300">
        {step.outcome}
      </div>
    </div>
  );
}
