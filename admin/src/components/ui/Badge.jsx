import { cn } from './cn';

export const STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  past_due: 'bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300',
  canceled: 'bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-300',
  expired: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300',
  revoked: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300',
};

export const STATUS_CHART_COLORS = {
  pending: '#d97706',
  active: '#059669',
  past_due: '#ea580c',
  canceled: '#6b7280',
  expired: '#dc2626',
  revoked: '#dc2626',
};

export function StatusBadge({ status }) {
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium',
        STATUS_STYLES[status] || 'bg-bg-alt text-text'
      )}
    >
      {status}
    </span>
  );
}

export function Badge({ children, className }) {
  return (
    <span className={cn('inline-block rounded-full bg-bg-alt px-2 py-0.5 text-xs font-medium text-text', className)}>
      {children}
    </span>
  );
}
