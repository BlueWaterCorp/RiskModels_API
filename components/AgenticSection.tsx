'use client';

import { ArrowRight, Bot, Terminal, X } from 'lucide-react';
import Link from 'next/link';

export default function AgenticSection() {
  return (
    <section className="w-full py-20 px-4 sm:px-6 lg:px-8 bg-zinc-950 border-y border-zinc-800">
      <div className="max-w-6xl mx-auto">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-4">
            What Makes It <span className="text-primary">Agentic</span>
          </h2>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
            Traditional APIs give you data. You do the work.
            RiskModels does the work for you.
          </p>
        </div>

        {/* Comparison Cards */}
        <div className="grid md:grid-cols-2 gap-8 mb-16">
          {/* Traditional API */}
          <div className="p-8 rounded-xl border border-zinc-700 bg-zinc-900/30">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-lg bg-zinc-800 flex items-center justify-center">
                <Terminal className="text-zinc-400" size={24} />
              </div>
              <h3 className="text-xl font-semibold text-zinc-300">Traditional APIs</h3>
            </div>

            <p className="text-sm text-zinc-500 mb-6">You own every step</p>

            <ul className="space-y-4">
              {[
                'You construct the query payload',
                'You call the endpoint',
                'You parse the response',
                'You interpret factor weights',
                'You compute drift vs benchmark',
                'You decide what hedge to use',
                'You implement the trade',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-3 text-zinc-400">
                  <span className="text-zinc-600 mt-0.5">→</span>
                  {step}
                </li>
              ))}
            </ul>

            <div className="mt-8 pt-6 border-t border-zinc-700">
              <p className="text-zinc-500 text-sm">
                You = the risk engine. API = a data pipe.
              </p>
            </div>
          </div>

          {/* Agentic API */}
          <div className="p-8 rounded-xl border border-primary/30 bg-primary/5">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center">
                <Bot className="text-primary" size={24} />
              </div>
              <h3 className="text-xl font-semibold text-white">RiskModels Agentic</h3>
            </div>

            <p className="text-sm text-primary/70 mb-6">You own the outcome</p>

            <ul className="space-y-4">
              {[
                'You delegate the task',
                'Agent decomposes portfolio into factors',
                'Agent identifies drift vs target',
                'Agent flags exposure anomalies',
                'Agent calculates optimal hedges',
                'Agent returns actionable decisions',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-3 text-zinc-300">
                  <span className="text-primary mt-0.5">✓</span>
                  {step}
                </li>
              ))}
            </ul>

            <div className="mt-8 pt-6 border-t border-primary/20">
              <p className="text-zinc-300 text-sm">
                You = the decision-maker. API = the risk engine.
              </p>
            </div>
          </div>
        </div>

        {/* Code Example */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-red-500/80" />
              <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <span className="w-3 h-3 rounded-full bg-green-500/80" />
            </div>
            <span className="text-xs text-zinc-600 font-mono">agentic-workflow.sh</span>
          </div>
          <div className="p-6 overflow-x-auto">
            <pre className="text-sm font-mono leading-relaxed">
              <code className="text-zinc-300">
                <span className="text-zinc-500">{'# Install the CLI'}</span>
                <br />
                <span className="text-emerald-400">$ npm install -g riskmodels-cli</span>
                <br />
                <br />
                <span className="text-zinc-500">{'# Configure your API key'}</span>
                <br />
                <span className="text-white">$ riskmodels</span>{' '}
                <span className="text-blue-400">config</span>{' '}
                <span className="text-zinc-500">set apiKey rm_live_...</span>
                <br />
                <br />
                <span className="text-zinc-500">{'# Delegate a task to the agent'}</span>
                <br />
                <span className="text-white">$ riskmodels</span>{' '}
                <span className="text-blue-400">agent</span>{' '}
                <span className="text-zinc-500">decompose --portfolio ./my_positions.json</span>
                <br />
                <br />
                <span className="text-zinc-500">{'# Agent returns actionable intelligence'}</span>
                <br />
                <span className="text-zinc-500">{'# → Factor exposure: 62% market beta, 18% momentum tilt'}</span>
                <br />
                <span className="text-zinc-500">{'# → Drift alert: size factor +2.1σ above target'}</span>
                <br />
                <span className="text-zinc-500">{'# → Hedge suggestion: short SPY 8.3% to neutralize beta'}</span>
              </code>
            </pre>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center mt-10">
          <Link
            href="/quickstart"
            className="group inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-all"
          >
            Try the Agentic API
            <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </div>
    </section>
  );
}
