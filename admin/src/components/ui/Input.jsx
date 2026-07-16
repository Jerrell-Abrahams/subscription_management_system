import { cn } from './cn';

const base =
  'w-full rounded-lg border border-border bg-bg text-sm text-text-h placeholder:text-text/40 focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50';

export function Input({ className, icon: Icon, ...props }) {
  if (Icon) {
    return (
      <div className="relative">
        <Icon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text/50" />
        <input className={cn(base, 'py-2 pl-9 pr-3', className)} {...props} />
      </div>
    );
  }
  return <input className={cn(base, 'px-3 py-2', className)} {...props} />;
}
