import { useRef } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Button } from './Button';

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirm', destructive, onConfirm }) {
  // Same reason as Modal: callers null the record being confirmed on close, which would
  // blank the title and description for the length of the exit animation.
  const last = useRef({ title: null, description: null });
  if (open) last.current = { title, description };

  const shown = open ? { title, description } : last.current;

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 bg-black/60 data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-panel p-5 shadow-[var(--shadow)] focus:outline-none data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out">
          <AlertDialog.Title className="text-[15px] font-semibold text-text">{shown.title}</AlertDialog.Title>
          {shown.description && (
            <AlertDialog.Description className="mt-2 text-[13px] leading-relaxed text-muted">
              {shown.description}
            </AlertDialog.Description>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
