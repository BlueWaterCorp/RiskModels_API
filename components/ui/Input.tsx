import { cn } from '@/lib/cn';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-100 placeholder:text-zinc-500',
        'focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500',
        'transition-colors',
        className
      )}
      {...props}
    />
  );
}
