import { cn } from './cn';

// Every status in the app collapses onto four tones. That is the design's rule, and it is
// why the label text is always rendered next to the dot: colour carries urgency, the word
// carries the meaning. Four colours cannot distinguish `canceled` from `void`, and are not
// asked to.
const TONE = {
  // Subscriptions (src/db/schema.sql)
  active: 'ok',
  pending: 'warn',
  past_due: 'warn',
  canceled: 'neutral',
  expired: 'bad',
  revoked: 'bad',

  // Invoices (src/db/invoices.sql)
  draft: 'neutral',
  sent: 'warn',
  paid: 'ok',
  void: 'neutral',

  // Websites (src/db/websites.sql)
  live: 'ok',
  suspended: 'bad',

  // Lead pipeline (src/db/leads.sql). No key collides with the above, so one map serves all.
  new: 'neutral',
  contacted: 'warn',
  follow_up: 'warn',
  potential: 'ok',
  not_interested: 'neutral',
  converted: 'ok',
};

// Written out rather than built as `bg-${tone}`: Tailwind scans source text for complete
// class names, and an interpolated one is never generated.
const TONE_CLASS = {
  ok: { dot: 'bg-ok', text: 'text-ok', border: 'border-ok' },
  warn: { dot: 'bg-warn', text: 'text-warn', border: 'border-warn' },
  bad: { dot: 'bg-bad', text: 'text-bad', border: 'border-bad' },
  neutral: { dot: 'bg-neutral', text: 'text-neutral', border: 'border-neutral' },
};

const toneOf = (status) => TONE_CLASS[TONE[status]] || TONE_CLASS.neutral;

// Derived so a new status can never be coloured one way in a table and another in a chart.
export const STATUS_CHART_COLORS = Object.fromEntries(
  Object.entries(TONE).map(([status, tone]) => [status, `var(--color-${tone})`])
);

// The default status rendering everywhere: 7px dot + the raw lowercase status string.
// align-middle because an inline-flex takes its baseline from its first flex item -- here a
// 7px dot -- so dropped next to text it sits low. Inert when it is a cell's only content.
export function StatusBadge({ status, className }) {
  const tone = toneOf(status);
  return (
    <span className={cn('inline-flex items-center gap-1.5 align-middle text-[12.5px]', tone.text, className)}>
      <span className={cn('h-[7px] w-[7px] flex-none rounded-full', tone.dot)} />
      <span className={status === 'void' ? 'line-through' : undefined}>{status}</span>
    </span>
  );
}

// The outlined variant, used only where a status needs to hold its own against a 24px
// heading: the subscription-detail header and the website cards.
export function StatusPill({ status, className }) {
  const tone = toneOf(status);
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 align-middle text-[11.5px]',
        tone.text,
        tone.border,
        className
      )}
    >
      <span className={cn('h-1.5 w-1.5 flex-none rounded-full', tone.dot)} />
      {status}
    </span>
  );
}

// Non-status chip -- roles, counts, version numbers.
export function Badge({ children, className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border border-border-2 px-2 py-0.5 text-[11.5px] text-muted',
        className
      )}
    >
      {children}
    </span>
  );
}
