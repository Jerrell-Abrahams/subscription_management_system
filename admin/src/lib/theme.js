import { useEffect, useState } from 'react';

// Dark is the default; light is opt-in and stored. The initial value is read off the
// <html> element rather than from localStorage, because the inline script in index.html
// has already applied the stored choice before React mounts -- reading storage again
// here would just be a second source of truth that can disagree during a rename.
const current = () => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

export function useTheme() {
  const [theme, setTheme] = useState(current);

  useEffect(() => {
    // Dark carries no attribute: it is what the stylesheet defaults to, so removing the
    // attribute and setting data-theme="dark" would be the same paint with more state.
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // Private mode rejects writes. The toggle still works for this session.
    }
  }, [theme]);

  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}
