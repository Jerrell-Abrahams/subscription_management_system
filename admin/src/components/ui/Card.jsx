import { cn } from './cn';

export function Card({ className, ...props }) {
  return <div className={cn('rounded-lg border border-border bg-panel p-4', className)} {...props} />;
}

// Header strip with the hairline the design puts under every card title. Separate from
// Card's padding because the hairline has to run the full width, which a padded parent
// cannot do without negative margins at every call site.
export function CardHeader({ className, ...props }) {
  return (
    <div
      className={cn('flex items-center justify-between gap-3 border-b border-border px-4 py-3.5', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }) {
  return <h3 className={cn('text-[13.5px] font-semibold text-text', className)} {...props} />;
}

// Mono uppercase micro-label: section headings, KPI labels, stat-strip labels.
export function MicroLabel({ className, ...props }) {
  return (
    <div className={cn('font-mono text-[10.5px] uppercase tracking-[0.12em] text-dim', className)} {...props} />
  );
}
