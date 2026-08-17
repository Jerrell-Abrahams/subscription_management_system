import { cn } from './ui/cn';
import logoDark from '../assets/logo-dark.svg';
import logoLight from '../assets/logo-light.svg';

// Both marks render and CSS picks one. Reading the theme in JS instead means every logo
// needs a useTheme instance, and those don't talk to each other -- with the toggle on
// Settings, the sidebar's copy would keep the old mark until the next remount.
export function Logo({ className }) {
  const cls = cn('w-auto object-contain object-left', className);
  return (
    <>
      <img src={logoLight} alt="Complex AI" className={cn('dark:hidden', cls)} />
      <img src={logoDark} alt="" aria-hidden className={cn('hidden dark:block', cls)} />
    </>
  );
}
