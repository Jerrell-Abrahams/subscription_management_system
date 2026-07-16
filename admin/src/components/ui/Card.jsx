import { cn } from './cn';

export function Card({ className, ...props }) {
  return <div className={cn('rounded-xl border border-border bg-bg-alt/50 p-4', className)} {...props} />;
}
