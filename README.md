# license-platform

Node.js + Express API for managing software subscriptions: activation,
renewal, status checks, usage analytics, and update distribution. Backed by
Supabase (Postgres + Auth). This API issues its own JWT (via `jsonwebtoken`)
on top of Supabase Auth sessions, since subscription endpoints need custom
claims/expiry independent of Supabase's own session tokens.

There are no license keys — a device "activates" by authenticating as the
subscription's owning user (email/password via `/api/auth/login`) and
calling activate for a specific product. Access is governed entirely by
whether that user has a subscription to that product.

## Setup

1. Create a Supabase project (or run one locally — see below).
2. Run `src/db/schema.sql` against its Postgres database.
3. In the Supabase dashboard, create a `products` row, e.g. `slug='desktop-app'`.
4. Copy `.env.example` to `.env` and fill in `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, and a `JWT_SECRET`.
5. `npm install`
6. `npm start` (or `npm run dev` for auto-reload). Confirm `GET /health`.
7. Create a user in Supabase Auth (and a matching `app_users` row), then
   `POST /api/auth/login` to get a JWT for the rest of the endpoints.

## Local development with the Supabase CLI

No cloud project needed for local dev — Docker required:

```
npx supabase init
npx supabase start        # prints local API URL + service_role key
# apply src/db/schema.sql against the printed DB connection string
npx supabase stop         # tear down when done
```

## Endpoints

| Method | Path                   | Auth | Description |
|--------|------------------------|------|-------------|
| GET    | `/health`                  | none | Liveness check |
| POST   | `/api/auth/login`          | none | `{ email, password }` → `{ token, user }` (rate-limited) |
| POST   | `/api/subscription/activate`| JWT  | `{ product, deviceFingerprint, deviceName? }` — binds a device to the caller's subscription for that product slug |
| GET    | `/api/subscription/status` | JWT  | `?product=<slug>` — subscription status + activation count |
| POST   | `/api/analytics`           | JWT  | `{ productId, eventType, payload? }` — records an event |
| GET    | `/api/updates/latest`      | none | `?product=<slug>` — latest release for a product |

Admin endpoints (`/api/admin/*`, Supabase session + `is_admin` required, used
by the dashboard in `admin/`): create users, reset passwords, and create /
cancel / revoke / renew subscriptions. Self-service renewal was deliberately
removed — with no payment provider wired up it was a free unlimited-extension
hole; renewal is admin-only until a payment webhook exists to trigger it.

## Known gaps (not yet done)

- Tests cover only the renewal date math (`npm test`, node:test) — no
  integration suite.
- No input validation library — manual `if (!x) return 400` checks only.
  Consider zod if the API grows.
- Rate limiting is in-memory per process — needs a shared store if this ever
  runs multi-instance.
- No logging/observability beyond `console.log`.
- `payments` table exists but no provider (Stripe/Paddle/etc.) is wired up;
  renewal stays admin-only until one is.
- `past_due` exists in the status enum but nothing sets or reads it —
  reserved for the future payment integration (it's Stripe's own status
  name); the admin UI deliberately doesn't offer it.
- Dashboard "Cancel" removes access immediately, not at period end — revisit
  when real customers exist.

## Second project: Google Play billing (not started)

Plan sketch — needs an RTDN Pub/Sub webhook + Play Developer API
purchase-token verification, reusing this same `subscriptions`/`activations`
schema but skipping `payments` (Play handles billing state).
