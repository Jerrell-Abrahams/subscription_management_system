// Run by the root npm test (node --test). Pure functions, no react, no supabase.
//
// Google Places search results are not leads -- nothing reaches the database until you log
// a call against one -- so they only ever lived in component state, and Leads.jsx unmounts
// the moment you open another tab. That made a billable search disappear because you went
// to check an invoice. These keep them in localStorage instead.
//
// Storage is passed in rather than reached for, so the branches below (missing, corrupt,
// wrong shape) are testable without a browser.

export const RESULTS_KEY = 'leads:results';

const EMPTY = { at: null, results: [] };

export function readSavedResults(storage) {
  let raw = null;
  try {
    raw = storage.getItem(RESULTS_KEY);
  } catch {
    return EMPTY; // storage disabled entirely (private mode, blocked cookies)
  }
  if (!raw) return EMPTY;

  try {
    const saved = JSON.parse(raw);
    if (!saved || !Array.isArray(saved.results)) throw new Error('wrong shape');
    return { at: saved.at || null, results: saved.results };
  } catch {
    // A write interrupted by a tab close leaves a truncated value. Drop it rather than
    // throwing during render, which would take the page down with no error boundary above.
    try {
      storage.removeItem(RESULTS_KEY);
    } catch {
      // nothing else to try
    }
    return EMPTY;
  }
}

export function saveResults(storage, { at, results }) {
  try {
    if (results.length) storage.setItem(RESULTS_KEY, JSON.stringify({ at, results }));
    else storage.removeItem(RESULTS_KEY);
  } catch {
    // Quota, or storage disabled. The results are on screen either way; losing the backup
    // is not worth interrupting a calling session over.
  }
}

// Age, not an expiry. The whole point is to stop paying twice for the same data, so these
// are kept until you replace or clear them -- but a week-old list quietly reappearing would
// mislead, so the UI says how old it is and lets you judge.
//
// Not Leads.jsx's agoLabel, which is day-granular ("today" / "3 days ago"). That is right
// for "when did I last call this lead" and useless here, where the common case is coming
// back to a search minutes later and needing to know it is still the one you just paid for.
export function freshnessLabel(iso) {
  // new Date(null) is the epoch, not an invalid date, so a missing timestamp would
  // otherwise read as "20684 days ago" rather than falling through to the guard below.
  const at = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(at)) return 'just now';
  // A negative age (clock skew, or a timestamp from the future) lands here too.
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
