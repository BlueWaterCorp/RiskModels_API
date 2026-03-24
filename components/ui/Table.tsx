import { cn } from '@/lib/cn';

export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full text-sm border-separate border-spacing-0', className)} {...props} />
    </div>
  );
}

export function TableHeader({ ...props }: React.ComponentProps<'thead'>) {
  return <thead {...props} />;
}

export function TableBody({ ...props }: React.ComponentProps<'tbody'>) {
  return <tbody {...props} />;
}

export function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'border-b border-zinc-800/25 transition-colors last:border-0 hover:bg-zinc-900/40',
        className
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'px-0 py-2.5 pr-6 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 first:pl-0 last:pr-0',
        className
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td className={cn('px-0 py-3 pr-6 align-top text-zinc-300 first:pl-0 last:pr-0', className)} {...props} />
  );
}
