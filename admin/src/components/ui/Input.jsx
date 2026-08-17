import { cn } from './cn';

// 34px is the form-field height from the design. Toolbars use 32 and the auth screen 38 --
// both pass a height class rather than this growing a size prop for two call sites.
const base =
  'h-[34px] w-full rounded-md border border-border-2 bg-panel px-[11px] text-[13.5px] text-text ' +
  'placeholder:text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50';

export function Input({ className, icon: Icon, ...props }) {
  if (Icon) {
    return (
      <div className="relative">
        <Icon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
        <input className={cn(base, 'pl-9 pr-3', className)} {...props} />
      </div>
    );
  }
  return <input className={cn(base, className)} {...props} />;
}

// Label + control + optional hint. This markup was hand-written 30 times across the six
// screens with forms, which is how three "create" modals ended up with no labels at all --
// a bare <Select> renders as the word "monthly" and nothing says what it sets.
//
// A <label> wrapping its control is the association; no htmlFor/id to keep in sync. Radix's
// Select trigger is a button, so the click-to-focus still works. Pass as="div" for a group
// holding more than one control -- nested <label>s are invalid and make the click target
// ambiguous.
export function Field({ label, hint, as: Tag = 'label', className, children }) {
  return (
    <Tag className={cn('flex flex-col gap-1.5 text-xs font-medium text-text/70', className)}>
      {label}
      {children}
      {hint ? <span className="font-normal text-text/50">{hint}</span> : null}
    </Tag>
  );
}
