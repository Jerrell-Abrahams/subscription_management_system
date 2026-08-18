import { AnimatePresence, motion } from 'motion/react';
import { cn } from './cn';

// The design draws tables as CSS grids with per-screen column ratios. This stays a real
// <table> and restyles to match: same 8px-radius bordered container, same --raised mono
// header, same var(--rp) row rhythm, but every existing page keeps its markup. Column
// ratios are a per-screen concern and belong on the <Th>, not in here.
export function Table({ className, ...props }) {
  return (
    // ponytail: on a phone these scroll sideways rather than reflowing into per-row cards.
    // Ceiling is column count -- Leads and Finance are the widest. Build the card view when
    // one of those is genuinely unusable on a phone, not before.
    <div className="overflow-x-auto rounded-lg border border-border bg-panel">
      <table className={cn('w-full border-collapse text-[13px]', className)} {...props} />
    </div>
  );
}

export function Thead(props) {
  return <thead className="bg-raised" {...props} />;
}

// AnimatePresence lives here rather than at each call site so every table in the app gets
// row enter/exit from one edit. It renders no DOM node of its own, so <tbody> keeps a
// valid child list, and every existing .map already supplies the key it needs.
export function Tbody({ children, ...props }) {
  return (
    <tbody {...props}>
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </tbody>
  );
}

// Opacity only. A <tr> cannot animate its height without the cells collapsing first, and
// the fade already reads as "this row left" -- deletes refetch, so the row is gone from
// the next render either way.
export function Tr({ className, ...props }) {
  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14 }}
      className={cn('border-t border-border transition-colors', className)}
      {...props}
    />
  );
}

export function Th({ className, ...props }) {
  return (
    <th
      className={cn(
        'px-4 py-[9px] text-left font-mono text-[10.5px] font-normal uppercase tracking-[0.11em] text-dim',
        className
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }) {
  return <td className={cn('px-4 py-[var(--rp)] text-muted', className)} {...props} />;
}
