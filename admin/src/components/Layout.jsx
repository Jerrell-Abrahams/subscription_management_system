import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  LayoutGrid,
  CreditCard,
  PhoneCall,
  Users,
  Globe,
  Package,
  Wallet,
  Receipt,
  FileText,
  Rocket,
  Activity,
  SlidersHorizontal,
  ChevronsUpDown,
  LogOut,
  Menu,
  Plus,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';
import { today } from '../lib/format';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/DropdownMenu';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Skeleton } from './ui/Skeleton';
import { cn } from './ui/cn';
import { Logo } from './Logo';

// Labels follow the redesign (Dashboard→Overview, Users→Customers, Products→Plans,
// Updates→Releases); the routes are unchanged, so nothing else in the app moves.
const navMain = [
  { to: '/', label: 'Overview', icon: LayoutGrid, end: true },
  { to: '/subscriptions', label: 'Subscriptions', icon: CreditCard },
  { to: '/leads', label: 'Leads', icon: PhoneCall },
  { to: '/users', label: 'Customers', icon: Users },
  { to: '/websites', label: 'Websites', icon: Globe },
  { to: '/products', label: 'Plans', icon: Package },
  { to: '/finance', label: 'Finance', icon: Wallet },
  { to: '/invoices', label: 'Invoices', icon: Receipt },
  { to: '/documents', label: 'Documents', icon: FileText },
];

const navSecondary = [
  { to: '/updates', label: 'Releases', icon: Rocket },
  { to: '/analytics', label: 'Analytics', icon: Activity },
  { to: '/settings', label: 'Settings', icon: SlidersHorizontal },
];

// The four consoles this system actually runs on, so they're one click away instead of a
// search every time. Supabase lands on THIS project rather than the project picker by
// reusing the URL the client already has -- the ref is the subdomain of
// https://<ref>.supabase.co. Vercel has no equivalent hint on the client (the admin build
// doesn't know its own project id), so it stops at the dashboard.
const supabaseRef = (import.meta.env.VITE_SUPABASE_URL || '').match(/https:\/\/([^.]+)\.supabase\./)?.[1];

// Official brand marks, inlined as their path data rather than pulling in an icon package
// for four glyphs. The first three are the Simple Icons paths (24x24, CC0); Payfast isn't
// in Simple Icons, so its chevron is lifted from the logo on payfast.io with the viewBox
// cropped to just that mark. Colour follows each brand where the brand has one -- GitHub
// and Vercel are officially black, which would disappear in dark mode, so they ride on
// currentColor and invert with the sidebar like the nav icons above.
const consoles = [
  {
    label: 'Supabase',
    href: supabaseRef ? `https://supabase.com/dashboard/project/${supabaseRef}` : 'https://supabase.com/dashboard/projects',
    color: '#3FCF8E',
    path: 'M11.9 1.036c-.015-.986-1.26-1.41-1.874-.637L.764 12.05C-.33 13.427.65 15.455 2.409 15.455h9.579l.113 7.51c.014.985 1.259 1.408 1.873.636l9.262-11.653c1.093-1.375.113-3.403-1.645-3.403h-9.642z',
  },
  {
    label: 'Vercel',
    href: 'https://vercel.com/dashboard',
    path: 'm12 1.608 12 20.784H0Z',
  },
  {
    label: 'GitHub',
    href: 'https://github.com/Jerrell-Abrahams/subscription_management_system',
    path: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  },
  {
    label: 'Payfast',
    href: 'https://my.payfast.io',
    color: '#E54360',
    viewBox: '101.78 6.14 10.39 15.58',
    path: 'M105.59,6.14h-3.81l6.58,7.82-6.51,7.76h3.81l6.51-7.76-6.58-7.82Z',
  },
];

function NavItem({ to, label, icon: Icon, end, badge }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex h-8 items-center gap-2.5 rounded-md px-[9px] text-[13px] no-underline transition-colors',
          isActive ? 'bg-raised font-medium text-text' : 'font-normal text-muted hover:bg-raised'
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={18} className={isActive ? 'text-accent' : 'text-dim'} />
          {label}
          {/* Only ever a count of things that are actionable TODAY. A badge that is always
              lit is a badge you stop seeing, so 0 renders nothing at all. */}
          {badge > 0 && (
            <span className="ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-bad/15 px-1.5 text-[10.5px] font-medium text-bad">
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

// Boot placeholder for <main> only -- the sidebar, header and crumb are the real thing, so
// there is no second copy of the chrome to keep in sync. Shaped after Dashboard because
// that is where "/" lands; every page then swaps in its own skeletons as its queries run.
function BootContent() {
  return (
    <>
      <Skeleton className="h-7 w-40" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-10" />
            </div>
          </Card>
        ))}
      </div>
      <Card>
        <Skeleton className="mb-3 h-4 w-44" />
        <Skeleton className="h-64 w-full" />
      </Card>
    </>
  );
}

// `loading` is the app boot gate (ProtectedRoute owns it): chrome renders, content does
// not. The outlet is withheld rather than hidden -- mounting a page before the session
// resolves would fire its queries unauthenticated.
export function Layout({ loading }) {
  const { session, logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // useOutlet(), not <Outlet />. Outlet resolves the match from route context at render
  // time, so the copy AnimatePresence holds mounted during the exit would re-render with
  // the *new* match -- you'd watch the incoming page fade out. useOutlet returns a
  // concrete element captured at this render, which is what the exiting frame needs.
  const outlet = useOutlet();

  // Two head-only counts (no rows come back), re-run on every navigation so the badge
  // can't keep claiming three overdue invoices right after you marked all three paid.
  // Gated on `loading` because ProtectedRoute hasn't resolved the session yet, and these
  // read RLS-protected tables.
  const [badges, setBadges] = useState({});
  useEffect(() => {
    if (loading) return;
    const count = { count: 'exact', head: true };
    Promise.all([
      supabase.from('invoices').select('id', count).eq('status', 'sent').lt('due_date', today()),
      supabase.from('leads').select('id', count).eq('status', 'follow_up').lte('follow_up_date', today()),
    ]).then(([invoices, leads]) =>
      setBadges({ '/invoices': invoices.count ?? 0, '/leads': leads.count ?? 0 })
    );
  }, [pathname, loading]);

  // A subscription detail page reads as "Subscription" in the crumb while keeping
  // Subscriptions lit in the sidebar -- matched before the list so /subscriptions/:id
  // doesn't fall through to the plain "Subscriptions" label.
  const screenTitle =
    /^\/subscriptions\/./.test(pathname)
      ? 'Subscription'
      : [...navMain, ...navSecondary].find((l) => (l.end ? pathname === l.to : pathname.startsWith(l.to)))?.label ||
        'Console';

  const email = session?.user?.email || '';
  const initials = email.slice(0, 2).toUpperCase();

  // Below lg the sidebar is a drawer. Closing on every navigation is the whole of its
  // state management -- tapping a link there is always "go there and get out of my way".
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]);

  // Widening past lg hides the drawer by CSS but leaves Radix's scroll lock on, which
  // reads as a frozen page. Closing it on the breakpoint crossing is the whole fix.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 64rem)');
    const close = () => mq.matches && setMenuOpen(false);
    mq.addEventListener('change', close);
    return () => mq.removeEventListener('change', close);
  }, []);

  // One copy of the sidebar body, rendered by the desktop <aside> or by the drawer. The
  // drawer's Dialog.Portal only mounts while open, so this is never in the tree twice.
  const sidebar = (
    <>
        <div className="border-b border-border px-4 pb-3.5 pt-[18px]">
          <Logo className="h-[42px]" />
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2.5 pt-3">
          {navMain.map((l) => (
            <NavItem key={l.to} {...l} badge={badges[l.to]} />
          ))}
          <div className="px-2.5 pb-1.5 pt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
            Distribution
          </div>
          {navSecondary.map((l) => (
            <NavItem key={l.to} {...l} />
          ))}
          <div className="px-2.5 pb-1.5 pt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
            Consoles
          </div>
          {consoles.map((c) => (
            <a
              key={c.label}
              href={c.href}
              target="_blank"
              rel="noreferrer"
              className="group/console flex h-8 items-center gap-2.5 rounded-md px-[9px] text-[13px] font-normal text-muted no-underline transition-colors hover:bg-raised"
            >
              {/* 18px box like the nav icons, but the mark itself sits at 15px so the
                  denser brand glyphs don't out-weigh the lucide strokes above. */}
              <svg
                viewBox={c.viewBox || '0 0 24 24'}
                width={15}
                height={15}
                className="flex-none"
                fill={c.color || 'currentColor'}
                aria-hidden="true"
                style={{ marginInline: '1.5px' }}
              >
                <path d={c.path} />
              </svg>
              {c.label}
              <ExternalLink size={12} className="ml-auto text-dim opacity-0 transition-opacity group-hover/console:opacity-100" />
            </a>
          ))}
        </nav>

        <div className="border-t border-border p-2.5">
          {loading ? (
            <div className="flex items-center gap-2.5 px-[9px] py-2">
              <Skeleton className="h-6 w-6 flex-none rounded-full" />
              <div className="flex flex-col gap-1">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-2.5 w-10" />
              </div>
            </div>
          ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-2.5 rounded-md px-[9px] py-2 text-left transition-colors hover:bg-raised">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-ink">
                  {initials}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[12.5px] font-medium text-text">{email}</span>
                  <span className="text-[11px] text-dim">Admin</span>
                </span>
                <ChevronsUpDown size={16} className="ml-auto flex-none text-dim" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={logout} className="flex items-center gap-2 text-bad">
                <LogOut size={15} />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          )}
        </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-bg text-text">
      <aside className="sticky top-0 hidden h-screen w-[236px] flex-none flex-col border-r border-border bg-panel lg:flex">
        {sidebar}
      </aside>

      {/* Radix Dialog rather than a hand-rolled translate: focus trap, Escape, background
          scroll lock and the exit animation all come with it, and it is already a
          dependency for every modal in the app. */}
      <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out lg:hidden" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 flex w-[236px] flex-col border-r border-border bg-panel focus:outline-none data-[state=open]:animate-drawer-in data-[state=closed]:animate-drawer-out lg:hidden"
          >
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            {sidebar}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-5 flex h-[54px] flex-none items-center gap-3 border-b border-border bg-bg px-4 sm:gap-3.5 sm:px-6">
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Open navigation"
            className="-ml-1.5 rounded-md p-1.5 text-muted transition-colors hover:bg-raised hover:text-text lg:hidden"
          >
            <Menu size={19} />
          </button>
          <div className="flex min-w-0 items-center gap-2 text-[13px]">
            <span className="hidden text-dim sm:inline">complex-ai</span>
            <span className="hidden text-border-2 sm:inline">/</span>
            <span className="truncate font-medium text-text">{screenTitle}</span>
          </div>
          <span className="hidden h-[22px] items-center gap-1.5 rounded-full border border-border-2 px-2 text-[11px] text-muted md:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
            Production
          </span>

          <div className="ml-auto flex items-center gap-2">
            {/* ponytail: routes to the list rather than opening its modal from here.
                Cross-page modal state needs a query param both sides agree on -- worth it
                when the Subscriptions screen is rebuilt, not before. */}
            <Button
              disabled={loading}
              aria-label="New subscription"
              className="max-sm:w-8 max-sm:px-0"
              onClick={() => navigate('/subscriptions')}
            >
              <Plus size={16} /> <span className="max-sm:hidden">New subscription</span>
            </Button>
          </div>
        </header>

        <main className="flex-1 px-4 pb-16 pt-6 sm:px-6 sm:pt-7">
          {/* mode="wait" runs the exit to completion before the enter starts, which keeps
              both pages out of the flex flow at once -- an overlapping crossfade would
              need absolute positioning and would drop the gap-[22px] rhythm below. The
              gap moves onto the animated div so exiting content keeps its spacing. */}
          <div className="mx-auto max-w-[1240px]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={loading ? 'boot' : pathname}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="flex flex-col gap-[22px]"
              >
                {loading ? <BootContent /> : outlet}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
