// Copy to the root of each customer site as `middleware.js` (Next.js App Router).
// Set LICENSE_API_URL in the site's Vercel env to your API base.
import { NextResponse } from 'next/server';

const API = process.env.LICENSE_API_URL;

// Run on page routes only; skip Next internals, the suspended page itself, and the favicon.
export const config = { matcher: ['/((?!_next|suspended|favicon.ico).*)'] };

export async function middleware(req) {
  try {
    const host = req.headers.get('host');
    const r = await fetch(`${API}/api/site/status?domain=${encodeURIComponent(host)}`, {
      next: { revalidate: 60 }, // cache 60s at the edge; matches the API's Cache-Control
    });
    const { active } = await r.json();
    if (!active) {
      return NextResponse.rewrite(new URL('/suspended', req.url));
    }
  } catch {
    // Fail open: never take a paying site down because the status API blipped.
    // Ceiling: a non-payer who also knocks out the status API stays up -- acceptable.
  }
  return NextResponse.next();
}
