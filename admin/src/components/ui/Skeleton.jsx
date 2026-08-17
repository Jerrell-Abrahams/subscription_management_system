import { Tr, Td } from './Table';
import { cn } from './cn';

// One bar. Size it at the call site -- `<Skeleton className="h-3 w-24" />`. There are no
// per-page skeleton components on purpose: a skeleton that has to be kept in sync with a
// layout is a second copy of that layout, and it always rots.
export function Skeleton({ className }) {
  return <div className={cn('animate-pulse rounded bg-skeleton', className)} />;
}

// Table body placeholder. Renders real <Tr>/<Td> so it inherits the var(--rp) row rhythm
// and border hairlines rather than restating them.
//
// `actions` matters more than it looks: rows containing <Button> are ~54px tall (h-8 plus
// padding) against the ~42px a text row measures, so a uniform skeleton row would make
// Users/Websites/Leads jump when real data lands.
export function SkeletonRows({ cols, rows = 5, actions = false }) {
  // Varied widths so the block reads as text rather than a barcode. Cycled, not random --
  // a random width per render would reshuffle on every re-render while still loading.
  const widths = ['w-32', 'w-20', 'w-28', 'w-16', 'w-24'];

  return Array.from({ length: rows }, (_, r) => (
    <Tr key={`skeleton-${r}`}>
      {Array.from({ length: cols }, (_, c) => (
        <Td key={c}>
          {actions && c === cols - 1 ? (
            <Skeleton className="h-8 w-20" />
          ) : (
            <Skeleton className={cn('h-3', widths[(r + c) % widths.length])} />
          )}
        </Td>
      ))}
    </Tr>
  ));
}
