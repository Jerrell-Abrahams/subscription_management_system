import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { cn } from './cn';

export const DropdownMenu = Dropdown.Root;
export const DropdownMenuTrigger = Dropdown.Trigger;

export function DropdownMenuContent({ className, align = 'start', ...props }) {
  return (
    <Dropdown.Portal>
      <Dropdown.Content
        align={align}
        sideOffset={6}
        className={cn(
          'z-50 min-w-[160px] rounded-lg border border-border bg-bg p-1 shadow-lg',
          className
        )}
        {...props}
      />
    </Dropdown.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }) {
  return (
    <Dropdown.Item
      className={cn(
        'cursor-pointer rounded-md px-2.5 py-1.5 text-sm text-text-h outline-none data-[highlighted]:bg-bg-alt',
        className
      )}
      {...props}
    />
  );
}
