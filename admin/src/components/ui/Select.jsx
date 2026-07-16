import * as RadixSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from './cn';

export function Select({ value, onValueChange, placeholder, children, className, disabled }) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-h focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50 data-[placeholder]:text-text/40',
          className
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <ChevronDown size={14} className="text-text/50" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 overflow-hidden rounded-lg border border-border bg-bg shadow-lg"
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
      className="relative flex cursor-pointer select-none items-center rounded-md px-2.5 py-1.5 pr-7 text-sm text-text-h outline-none data-[highlighted]:bg-bg-alt data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
    >
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
      <RadixSelect.ItemIndicator className="absolute right-2 inline-flex items-center">
        <Check size={14} />
      </RadixSelect.ItemIndicator>
    </RadixSelect.Item>
  );
}
