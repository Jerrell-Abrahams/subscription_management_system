import { cn } from './cn';

// Destructive is an outline, not a filled red button: in this console the destructive
// actions (revoke, delete, rotate key) sit in rows of otherwise-neutral buttons, and a
// solid red block reads as the primary action of the row rather than its danger.
const VARIANTS = {
  primary: 'bg-accent text-accent-ink font-semibold border border-transparent hover:opacity-90',
  secondary: 'bg-transparent text-text border border-border-2 hover:bg-raised',
  ghost: 'bg-transparent text-muted border border-transparent hover:bg-raised hover:text-text',
  destructive: 'bg-bad/8 text-bad border border-bad/35 hover:bg-bad/15',
};

export function Button({ variant = 'primary', className, ...props }) {
  return (
    <button
      className={cn(
        // whitespace-nowrap/shrink-0: as flex children these squeeze to min-content and the
        // label wraps out of the fixed height, which reads as the padding having vanished.
        'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[12.5px] font-medium',
        // The design specifies the focus ring as color-mix(accent 40%, transparent);
        // ring-accent/40 is Tailwind's own spelling of exactly that and compiles to the
        // same color-mix, so there is no arbitrary value here to typo or mis-infer.
        'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        className
      )}
      {...props}
    />
  );
}

// Square 32px button for a bare icon -- topbar theme/notification controls, row actions.
export function IconButton({ className, ...props }) {
  return <Button variant="secondary" className={cn('w-8 px-0', className)} {...props} />;
}
