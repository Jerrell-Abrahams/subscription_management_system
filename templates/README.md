# Customer site templates

Copy these two files into each website you sell (Next.js App Router on Vercel).
They enforce the block you flip in the admin dashboard.

## Setup
1. Copy `site-middleware.js` to the site root as `middleware.js`.
2. Copy `suspended-page.jsx` to `app/suspended/page.jsx` (customize the branding).
3. Set `LICENSE_API_URL` in the site's Vercel env to your API base
   (e.g. `https://your-api.vercel.app`).
4. Register the site's domain in the admin dashboard (Websites → Add website).

## How it blocks
On every request the middleware asks `GET $LICENSE_API_URL/api/site/status?domain=<host>`.
The site serves normally while the answer is `{ active: true }`; when you **Suspend**
it (or its billing period lapses), the answer flips to `{ active: false }` and the
middleware rewrites every route to `/suspended`. Reactivate it and it serves again
within the 60s cache window.

The check **fails open**: if the API is unreachable, or the domain isn't registered
yet, the site keeps serving. A site is only ever dark once it's registered *and*
suspended/expired.
