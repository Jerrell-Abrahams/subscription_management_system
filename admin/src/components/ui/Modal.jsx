import { useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

export function Modal({ open, onOpenChange, title, children }) {
  // Callers drive this with the truthy-object idiom -- open={!!editingUser}, and
  // onOpenChange nulls the record. That null lands one render before Radix finishes the
  // exit animation, so the box would empty out and then fade. Holding the last rendered
  // content covers the exit for every call site at once, instead of asking each one to
  // defer its own cleanup.
  const last = useRef({ title: null, children: null });
  if (open) last.current = { title, children };

  const shown = open ? { title, children } : last.current;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out" />
        <Dialog.Content className="fixed left-1/2 top-1/2 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-panel p-4 shadow-[var(--shadow)] focus:outline-none data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-[15px] font-semibold text-text">{shown.title}</Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded-md p-1 text-dim transition-colors hover:bg-raised hover:text-text" aria-label="Close">
                <X size={17} />
              </button>
            </Dialog.Close>
          </div>
          {shown.children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
