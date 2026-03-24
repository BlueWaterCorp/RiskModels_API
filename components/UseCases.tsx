import { Zap, Radar, ArrowLeftRight, Scale, Activity, RefreshCw, Shield } from 'lucide-react';

const useCases = [
  {
    icon: Shield,
    title: 'Pre-Trade Risk Check',
    subtitle: 'Factor-exposure guardrails',
    description:
      'Before every execution, the agent evaluates the trade\'s marginal factor impact. Automatically blocks orders that would push any factor exposure beyond your defined thresholds.',
    example: 'Block order: size exposure would exceed 2.0σ limit',
    color: 'emerald',
  },
  {
    icon: Activity,
    title: 'Drift Monitoring',
    subtitle: 'Intraday alerts',
    description:
      'Set a target factor profile. The agent monitors intraday and fires alerts when portfolio beta, sector tilt, or size exposure drifts beyond your defined sigma bands.',
    example: 'Alert: momentum tilt +1.8σ above target',
    color: 'amber',
  },
  {
    icon: ArrowLeftRight,
    title: 'Hedge Recommendations',
    subtitle: 'Hedging optimization + position-sizing',
    description:
      'Given current factor exposures and your hedging universe, the agent calculates the minimum-cost hedge to neutralize unwanted risk — optimal position sizes included.',
    example: 'Hedge: short QQQ $47K, long XLU $12K',
    color: 'blue',
  },
  {
    icon: RefreshCw,
    title: 'Rebalance Triggers',
    subtitle: 'Factor-tilt portfolio management',
    description:
      'The agent identifies when cumulative factor drift warrants a full rebalance, surfaces specific positions causing the tilt, and suggests trade directions to restore alignment.',
    example: 'Trigger: tech sector concentration > 35%',
    color: 'purple',
  },
];

export default function UseCases() {
  return (
    <section className="w-full py-20 px-4 sm:px-6 lg:px-8 bg-zinc-950">
      <div className="max-w-6xl mx-auto">
        {/* Section Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 text-sm font-medium mb-6">
            <Zap size={16} className="text-primary" />
            What Funds Are Building With It
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Four Patterns. Complete Coverage.
          </h2>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
            These patterns cover most of what a risk team does manually today.
            Now automated.
          </p>
        </div>

        {/* Use Cases Grid */}
        <div className="grid md:grid-cols-2 gap-6">
          {useCases.map((useCase) => {
            const Icon = useCase.icon;
            return (
              <div
                key={useCase.title}
                className="group p-8 rounded-xl border border-zinc-800 bg-zinc-900/20 hover:bg-zinc-900/40 hover:border-zinc-700 transition-all"
              >
                {/* Icon & Title */}
                <div className="flex items-start gap-4 mb-4">
                  <div className={`w-12 h-12 rounded-lg bg-${useCase.color}-500/10 border border-${useCase.color}-500/20 flex items-center justify-center flex-shrink-0`}>
                    <Icon className={`text-${useCase.color}-400`} size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-white group-hover:text-primary transition-colors">
                      {useCase.title}
                    </h3>
                    <p className={`text-sm text-${useCase.color}-400/80 mt-0.5`}>
                      {useCase.subtitle}
                    </p>
                  </div>
                </div>

                {/* Description */}
                <p className="text-zinc-400 leading-relaxed mb-4">
                  {useCase.description}
                </p>

                {/* Example */}
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-zinc-600">→</span>
                  <span className="text-zinc-300 font-mono bg-zinc-950 px-2 py-1 rounded">
                    {useCase.example}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Architecture Note */}
        <div className="mt-16 p-6 rounded-xl border border-zinc-800 bg-zinc-900/20">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Scale className="text-primary" size={20} />
            </div>
            <div className="flex-1">
              <h4 className="text-lg font-semibold text-white mb-1">
                Works alongside your existing systems
              </h4>
              <p className="text-zinc-400 text-sm">
                Webhooks, polling, or streaming — wire alerts to Slack, email, or your OMS directly.
                The agent integrates without disrupting your current workflow.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
