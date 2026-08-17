import * as RadixSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from './cn';

export function Select({ value, onValueChange, placeholder, children, className, disabled }) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger
        className={cn(
          'flex h-[34px] w-full items-center justify-between gap-2 rounded-md border border-border-2 bg-panel px-[11px]',
          'text-[13.5px] text-text transition-colors hover:bg-raised focus:outline-none',
          'focus-visible:ring-2 focus-visible:ring-accent/40',
          'disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-dim',
          className
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <ChevronDown size={14} className="text-dim" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className={cn(
            'z-50 overflow-hidden rounded-md border border-border bg-panel shadow-[var(--shadow)]',
            'origin-[var(--radix-select-content-transform-origin)]',
            'data-[state=open]:animate-menu-in data-[state=closed]:animate-menu-out'
          )}
        >
          <RadixSelect.Viewport className="p-1">{children}</RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

export function SelectItem({ value, children, disabled }) {
  return (
    <RadixSelect.Item
      value={value}
      disabled={disabled}
      className="relative flex cursor-pointer select-none items-center rounded-sm px-2.5 py-1.5 pr-7 text-[13px] text-text outline-none data-[highlighted]:bg-raised data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
    >
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
      <RadixSelect.ItemIndicator className="absolute right-2 inline-flex items-center text-accent">
        <Check size={14} />
      </RadixSelect.ItemIndicator>
    </RadixSelect.Item>
  );
}
