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
          'z-50 min-w-[180px] rounded-md border border-border bg-panel p-1 shadow-[var(--shadow)]',
          // Radix computes the origin from which side it opened, so the menu grows out of
          // the trigger rather than out of its own centre.
          'origin-[var(--radix-dropdown-menu-content-transform-origin)]',
          'data-[state=open]:animate-menu-in data-[state=closed]:animate-menu-out',
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
        'cursor-pointer rounded-sm px-2.5 py-1.5 text-[13px] text-text outline-none data-[highlighted]:bg-raised',
        className
      )}
      {...props}
    />
  );
}
