import { cn } from '@/lib/cn';

type BadgeVariant = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'outline' | 'status';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  get: 'bg-emerald-950 text-emerald-400 border-emerald-700',
  post: 'bg-blue-950 text-blue-400 border-blue-700',
  put: 'bg-amber-950 text-amber-400 border-amber-700',
  delete: 'bg-red-950 text-red-400 border-red-700',
  patch: 'bg-violet-950 text-violet-400 border-violet-700',
  outline: 'bg-zinc-900/60 text-zinc-300 border-zinc-700',
  status: 'bg-zinc-900/60 text-zinc-300 border-zinc-700',
};

export function Badge({ variant = 'outline', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: number }) {
  const variant =
    status >= 200 && status < 300
      ? 'bg-emerald-950 text-emerald-400 border-emerald-700'
      : status >= 400 && status < 500
        ? 'bg-amber-950 text-amber-400 border-amber-700'
        : status >= 500
          ? 'bg-red-950 text-red-400 border-red-700'
          : 'bg-zinc-900/60 text-zinc-300 border-zinc-700';
  return (
    <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-mono font-medium', variant)}>
      {status}
    </span>
  );
}
