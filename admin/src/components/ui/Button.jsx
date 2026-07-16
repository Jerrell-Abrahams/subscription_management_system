import { cn } from './cn';

const VARIANTS = {
  primary: 'bg-accent text-white hover:opacity-90',
  secondary: 'bg-bg-alt text-text-h border border-border hover:bg-border/40',
  ghost: 'bg-transparent text-text-h hover:bg-bg-alt',
  destructive: 'bg-red-600 text-white hover:bg-red-700',
};

export function Button({ variant = 'primary', className, ...props }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant],
        className
      )}
      {...props}
    />
  );
}
