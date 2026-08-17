import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Search, Radar, Target, PhoneCall, CalendarClock, Trash2, Pencil, Plus, Archive, Check, MapPin, X, MessageCircle, TrendingUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { chartTooltip } from '../lib/chart';
import { money } from '../lib/format';
import { supabase } from '../supabaseClient';
import {
  searchLeads,
  getLeadSearchUsage,
  importOneLead,
  logLeadActivity,
  updateLead,
  deleteLead,
  getLeadGoals,
  createLeadGoal,
  updateLeadGoal,
  deleteLeadGoal,
  createLeadCategory,
  deleteLeadCategory,
} from '../adminApi';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { Skeleton, SkeletonRows } from '../components/ui/Skeleton';
import { StatusBadge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Select, SelectItem } from '../components/ui/Select';

// Mirrors the method/outcome/status check constraints in src/db/leads.sql. Duplicated
// from src/lib/leads.js because the Vite bundle can't import CommonJS from src/ --
// same trade-off as PRODUCT_MODULES in SubscriptionDetail.jsx.
const METHODS = [
  { value: 'cold_call', label: 'Cold call', short: 'calls', fill: '#2563eb' },
  { value: 'walk_in', label: 'Walk-in', short: 'walk-ins', fill: '#7c3aed' },
  { value: 'cold_message', label: 'Cold message', short: 'messages', fill: '#0891b2' },
  { value: 'reach_out', label: 'Reach-out', short: 'reach-outs', fill: '#d97706' },
];

const OUTCOMES = [
  { value: 'no_answer', label: 'No answer / no decision-maker' },
  { value: 'follow_up', label: 'Follow up' },
  { value: 'potential', label: 'Potential lead' },
  { value: 'converted', label: 'Converted' },
  { value: 'not_interested', label: 'Not interested' },
];

const STATUSES = ['new', 'contacted', 'follow_up', 'potential', 'not_interested', 'converted'];

// value -> label, for rendering a lead's logged activities as readable history.
const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.value, m.label]));
const OUTCOME_LABEL = Object.fromEntries(OUTCOMES.map((o) => [o.value, o.label]));

// Mirrors the source check constraint in src/db/leads_goals_v2.sql. 'manual' is the
// escape hatch for anything the database can't see; the rest are counted server-side.
// Mirrors GOAL_SOURCES in src/lib/leads.js -- the Vite bundle can't import CommonJS from
// src/, same situation as CONTACT_METHODS above. `currency` marks the sources that sum
// rands; it only seeds the unit control, it does not decide it (a manual goal can be
// money too, which is why unit is its own column).
const GOAL_SOURCES = [
  { value: 'contacts', label: 'Contacts logged', auto: true },
  { value: 'conversions', label: 'Leads converted', auto: true },
  { value: 'leads_added', label: 'Leads added', auto: true },
  {
    value: 'revenue_received',
    label: 'Money received',
    auto: true,
    currency: true,
    note: 'Every payment in your Finance ledger, including once-off work with no subscription. Updates when you log the entry.',
  },
  {
    value: 'invoices_paid',
    label: 'Invoices paid',
    auto: true,
    currency: true,
    note: 'Subscription revenue only, counted the moment you mark an invoice paid. Blind to income that was never invoiced.',
  },
  { value: 'manual', label: 'I update it myself', auto: false },
];

// Category filters the counted lead sources only. finance_entries uses its own free-text
// vocabulary and invoices have no category column at all, so offering the lead categories
// against a money source would silently match nothing.
const CATEGORY_FILTERABLE = ['contacts', 'conversions', 'leads_added'];

// Radix treats '' as "nothing selected" (its shouldShowPlaceholder is `value === '' ||
// value === undefined`), so an item valued '' would render as the placeholder rather
// than as itself. An optional select therefore needs a sentinel value, or there is no
// way back to "none" once a category has been picked.
const NO_CATEGORY = '__none__';

const emptyGoal = {
  name: '',
  target: '',
  source: 'contacts',
  unit: 'count',
  category: '',
  manualCurrent: '',
  startDate: new Date().toLocaleDateString('sv'),
  dueDate: '',
};

const RANGE_DAYS = { '7d': 7, '30d': 30 };

const emptyActivity = { method: 'cold_call', outcome: '', category: '', note: '', followUpDate: '' };
const emptyEdit = { name: '', email: '', phone: '', category: '', status: '', follow_up_date: '', notes: '' };

// Monday 00:00 local -- the single definition of "this week" for both the KPI and the
// per-category goal progress.
function weekStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

function todayStr() {
  return new Date().toLocaleDateString('sv');
}

// Websites is the main pitch, so it wins whenever nothing more specific applies.
// Without this the default is categories[0], and since lead_categories comes back sorted
// by name that silently means 'custom-software' on every call.
const DEFAULT_CATEGORY = 'websites';

function defaultCategory(categories, leadCategory) {
  // A lead already pitched something keeps it, so logging a follow-up doesn't quietly
  // re-file the call under a different campaign.
  if (leadCategory) return leadCategory;
  return categories.includes(DEFAULT_CATEGORY) ? DEFAULT_CATEGORY : categories[0] || '';
}

// "today" / "3 days ago" reads faster than a date when you're scanning a call list to
// decide who is due another try.
function agoLabel(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

// Digits only, with a leading 0 swapped for South Africa's 27 country code so wa.me
// links resolve. ponytail: hardcoded ZA default -- the only market this tool targets
// today; swap 27 for another country code, or make it configurable, if that changes.
function waLink(phone) {
  if (!phone) return null;
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('0')) d = `27${d.slice(1)}`;
  return d ? `https://wa.me/${d}` : null;
}

// Comparable phone form for dedup: digits only with a leading 27/0 dropped, so
// "021 555 1234", "+27 21 555 1234" and "0215551234" all collapse to the same key.
function normPhone(phone) {
  return (phone || '').replace(/\D/g, '').replace(/^(27|0)/, '');
}

// A hand-typed contact may already be a lead. Match on name (case-insensitive) or phone
// so logging a call to someone called before doesn't spawn a duplicate row.
function findLeadMatch(leads, name, phone) {
  const n = name.trim().toLowerCase();
  const p = normPhone(phone);
  return leads.find(
    (l) => (n && l.name?.trim().toLowerCase() === n) || (p && normPhone(l.phone) === p)
  );
}

// Google's free allowance is per calendar month; past it, searches cost real money, so
// this is shown wherever a search can be started rather than tucked away in settings.
function SearchQuota({ used, limit }) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const spent = used >= limit;
  const close = !spent && pct >= 80;
  const tone = spent ? 'text-red-600 dark:text-red-400' : close ? 'text-amber-600 dark:text-amber-400' : 'text-text/70';

  return (
    <div className="space-y-1">
      <div className={`flex items-center justify-between text-xs ${tone}`}>
        <span>
          {used} / {limit} free searches used this month
          {spent && ' — resets on the 1st'}
        </span>
        {close && <span>{limit - used} left</span>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-bg-alt">
        <div
          className={`h-full rounded-full transition-all ${spent ? 'bg-red-500' : close ? 'bg-amber-500' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {spent && (
        <p className="text-xs text-text/70">
          Searching is disabled so you are not billed. Raise <code>PLACES_SEARCH_CAP</code> to continue and pay Google.
        </p>
      )}
    </div>
  );
}

// Colour tracks urgency rather than decoration: hit = green, past its date = red,
// inside three days = amber. Everything else is the neutral accent.
function GoalCard({ goal, onEdit, onBump, onArchive }) {
  const isMoney = goal.unit === 'currency';
  const fmt = (n) => (isMoney ? money(n) : n);
  const pct = goal.target > 0 ? Math.min(100, Math.round((goal.current / goal.target) * 100)) : 0;
  const done = goal.current >= goal.target;
  const today = todayStr();
  const overdue = !done && goal.due_date && goal.due_date < today;
  const daysLeft = goal.due_date
    ? Math.round((new Date(`${goal.due_date}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000)
    : null;
  const soon = !done && !overdue && daysLeft !== null && daysLeft <= 3;

  const bar = done ? 'bg-emerald-500' : overdue ? 'bg-red-500' : soon ? 'bg-amber-500' : 'bg-accent';
  const dateTone = overdue ? 'text-red-600 dark:text-red-400' : soon ? 'text-amber-600 dark:text-amber-400' : 'text-text/60';

  let due = 'No deadline';
  if (goal.due_date) {
    if (overdue) due = `Overdue — was due ${goal.due_date}`;
    else if (daysLeft === 0) due = 'Due today';
    else if (daysLeft === 1) due = 'Due tomorrow';
    else due = `${daysLeft} days left`;
  }

  const source = GOAL_SOURCES.find((s) => s.value === goal.source);

  return (
    <Card className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-text-h">{goal.name}</p>
          <p className="text-xs text-text/60">
            {source?.label}
            {goal.category ? ` · ${goal.category}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button onClick={() => onEdit(goal)} className="rounded p-1 text-text/60 hover:bg-bg-alt hover:text-text-h" title="Edit">
            <Pencil size={13} />
          </button>
          <button onClick={() => onArchive(goal)} className="rounded p-1 text-text/60 hover:bg-bg-alt hover:text-text-h" title={goal.archived_at ? 'Restore' : 'Archive'}>
            <Archive size={13} />
          </button>
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-lg font-semibold text-text-h">
          {fmt(goal.current)}
          <span className="text-sm font-normal text-text/60"> / {fmt(goal.target)}</span>
        </span>
        {done ? (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <Check size={13} /> Done
          </span>
        ) : (
          <span className="text-xs text-text/60">{pct}%</span>
        )}
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-bg-alt">
        <div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="flex items-center justify-between">
        <span className={`text-xs ${dateTone}`}>{due}</span>
        {/* Manual goals are the only ones a click can move -- counted ones come from the
            log. Money goals get no ± at all: nobody clicks their way to R15,000, and the
            exact figure is set in the Current value field on the goal itself. */}
        {goal.source === 'manual' && !isMoney && !goal.archived_at && (
          <div className="flex gap-1">
            <Button variant="secondary" className="px-2 py-0.5 text-xs" onClick={() => onBump(goal, -1)}>
              −
            </Button>
            <Button variant="secondary" className="px-2 py-0.5 text-xs" onClick={() => onBump(goal, 1)}>
              +
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function KpiCard({ icon: Icon, label, value, sub }) {
  return (
    <Card className="flex items-center gap-3">
      <div className="rounded-lg bg-accent/10 p-2 text-accent">
        <Icon size={20} />
      </div>
      <div>
        <p className="text-xs text-text/70">{label}</p>
        {value === null ? (
          <Skeleton className="mt-1.5 h-5 w-10" />
        ) : (
          <p className="text-xl font-semibold text-text-h">{value}</p>
        )}
        {sub && <p className="text-xs text-text/60">{sub}</p>}
      </div>
    </Card>
  );
}

// Phone as tap-to-call plus a WhatsApp shortcut, so the log-contact buttons lead straight
// into the call or message rather than a number you copy out by hand.
function PhoneCell({ phone }) {
  if (!phone) return <span className="text-text/50">—</span>;
  const wa = waLink(phone);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <a href={`tel:${phone}`} className="text-accent hover:underline">{phone}</a>
      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noreferrer"
          className="text-emerald-600 hover:opacity-80 dark:text-emerald-400"
          title="Message on WhatsApp"
        >
          <MessageCircle size={13} />
        </a>
      )}
    </span>
  );
}

export function Leads() {
  // null = not loaded, [] = loaded and empty -- the same convention leadHistory below
  // already uses. Goals in particular used to claim "No goals yet" mid-fetch.
  const [leads, setLeads] = useState(null);
  const [activities, setActivities] = useState(null);
  const [goals, setGoals] = useState(null);
  const [categories, setCategories] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [goalsError, setGoalsError] = useState(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [range, setRange] = useState('7d');

  const [showFinder, setShowFinder] = useState(false);
  const [finder, setFinder] = useState({ location: '', industry: '', maxResults: '20', radius: '10000' });
  const [coords, setCoords] = useState(null); // { latitude, longitude } once located
  const [locating, setLocating] = useState(false);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  // A search result awaiting its first logged call -- not yet written to the database.
  const [pendingResult, setPendingResult] = useState(null);
  const [usage, setUsage] = useState(null);

  const [activityLead, setActivityLead] = useState(null);
  const [activityForm, setActivityForm] = useState(emptyActivity);
  const [editLead, setEditLead] = useState(null);
  const [editForm, setEditForm] = useState(emptyEdit);
  const [leadToDelete, setLeadToDelete] = useState(null);
  const [goalForm, setGoalForm] = useState(null); // null = closed, {} = new, {id} = editing
  const [showCategories, setShowCategories] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Client-side narrowing of the already-fetched (already-paid-for) search results, so no
  // filter costs another billable Google call.
  const [resultFilters, setResultFilters] = useState({ noWebsite: false, hasPhone: false, notContacted: false, minRating: '0' });
  // A lead's full activity log, loaded on demand when the details modal opens. null =
  // not loaded yet, [] = loaded and empty.
  const [leadHistory, setLeadHistory] = useState(null);

  // Goals come through the API rather than straight from supabase because their
  // progress is counted server-side, over windows that can outrun the 60-day activity
  // slice loaded below.
  async function loadGoals(archived = showArchived) {
    try {
      const { goals: rows } = await getLeadGoals(archived);
      setGoals(rows || []);
      setGoalsError(null);
    } catch (err) {
      // Surfaced rather than swallowed: an empty goals list and a broken goals list look
      // identical otherwise, which hides a missing migration behind "no goals yet".
      setGoals([]);
      setGoalsError(err.message);
    }
  }

  async function load() {
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const [{ data: leadRows }, { data: activityRows }, { data: categoryRows }] = await Promise.all([
      supabase.from('leads').select('*').order('created_at', { ascending: false }),
      supabase.from('lead_activities').select('occurred_at, method, category, outcome').gte('occurred_at', cutoff),
      supabase.from('lead_categories').select('name').order('name'),
    ]);
    setLeads(leadRows || []);
    setActivities(activityRows || []);
    setCategories((categoryRows || []).map((c) => c.name));
    loadGoals();
  }

  useEffect(() => {
    load();
  }, []);

  // Only the goal list changes, so this doesn't re-pull leads and activities.
  function toggleArchived() {
    const next = !showArchived;
    setShowArchived(next);
    loadGoals(next);
  }

  const loading = leads === null;
  // The two money sources measure different things and it matters which you pick, so the
  // form explains the one you're on rather than making you guess from the label.
  const sourceNote = GOAL_SOURCES.find((s) => s.value === goalForm?.source)?.note;
  // Memoised rather than `?? []` inline so the dependency arrays below stay stable.
  const leadRows = useMemo(() => leads ?? [], [leads]);
  const activityRows = useMemo(() => activities ?? [], [activities]);

  const stats = useMemo(() => {
    const startOfWeek = weekStart();
    const startOfToday = new Date().setHours(0, 0, 0, 0);

    let today = 0;
    let converted = 0;
    const weekByMethod = {};
    activityRows.forEach((a) => {
      // A no-answer is a dial, not a contact: it still stamps the lead as contacted (so the
      // list shows you called), but it doesn't count towards the contact KPIs or the
      // conversion rate's denominator. The chart below deliberately still plots it -- that
      // one is dialling activity, not people reached.
      if (a.outcome === 'no_answer') return;
      const at = new Date(a.occurred_at).getTime();
      if (at >= startOfToday) today += 1;
      if (at >= startOfWeek) {
        weekByMethod[a.method] = (weekByMethod[a.method] || 0) + 1;
        if (a.outcome === 'converted') converted += 1;
      }
    });
    const week = Object.values(weekByMethod).reduce((sum, n) => sum + n, 0);
    const rate = week > 0 ? Math.round((converted / week) * 100) : 0;

    const breakdown = METHODS.filter((m) => weekByMethod[m.value])
      .map((m) => `${weekByMethod[m.value]} ${m.short}`)
      .join(' · ');

    return { today, week, breakdown, converted, rate };
  }, [activityRows]);

  const chartData = useMemo(() => {
    const cutoff = Date.now() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000;
    const byDay = {};
    activityRows.forEach((a) => {
      if (new Date(a.occurred_at).getTime() < cutoff) return;
      const day = a.occurred_at.slice(0, 10);
      byDay[day] = byDay[day] || { date: day };
      byDay[day][a.method] = (byDay[day][a.method] || 0) + 1;
    });
    return Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
  }, [activityRows, range]);

  // Overdue, due today, and the next 7 days -- so a follow-up shows up before its date
  // passes rather than only once it's already late.
  const followUps = useMemo(() => {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 7);
    const max = horizon.toLocaleDateString('sv');
    return leadRows
      .filter((l) => l.status === 'follow_up' && l.follow_up_date && l.follow_up_date <= max)
      .sort((a, b) => a.follow_up_date.localeCompare(b.follow_up_date));
  }, [leadRows]);

  // The KPI counts only what's actionable now (overdue or today), not the upcoming ones.
  const dueNow = useMemo(() => {
    const today = todayStr();
    return followUps.filter((l) => l.follow_up_date <= today).length;
  }, [followUps]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return leadRows.filter((l) => {
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && l.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        l.name?.toLowerCase().includes(q) ||
        l.phone?.toLowerCase().includes(q) ||
        l.address?.toLowerCase().includes(q)
      );
    });
  }, [leadRows, search, statusFilter, categoryFilter]);

  // Applied to results already on screen -- purely a display narrowing, never a re-search.
  const visibleResults = useMemo(() => {
    const minRating = Number(resultFilters.minRating);
    return results.filter((r) => {
      if (resultFilters.noWebsite && r.website) return false;
      if (resultFilters.hasPhone && !r.phone) return false;
      if (resultFilters.notContacted && r.lead) return false;
      if (minRating > 0 && !(r.rating >= minRating)) return false;
      return true;
    });
  }, [results, resultFilters]);

  // Live "this is already a lead" hint for the manual log modal, recomputed as you type.
  const manualMatch = useMemo(
    () => (activityLead?.manual ? findLeadMatch(leadRows, activityForm.name || '', activityForm.phone || '') : null),
    [activityLead, activityForm.name, activityForm.phone, leadRows]
  );

  // Only when the finder is actually opened -- no reason to query on every page view.
  function toggleFinder() {
    setShowFinder((open) => {
      // Surfaced, not swallowed: a broken search log means the spend cap isn't working,
      // which is the one thing worth interrupting for.
      if (!open) getLeadSearchUsage().then(setUsage).catch((err) => toast.error(err.message));
      return !open;
    });
  }

  // Browser geolocation needs a secure context -- fine on localhost and on Vercel's
  // HTTPS, but it silently doesn't exist over plain http on a LAN address.
  function useMyLocation() {
    if (!navigator.geolocation) {
      toast.error("This browser can't share a location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setFinder((f) => ({ ...f, location: '' }));
        setLocating(false);
        toast.success('Using your current location.');
      },
      (err) => {
        setLocating(false);
        toast.error(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied — allow it in your browser, or type a place instead.'
            : "Couldn't get your location. Type a place instead."
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  async function handleSearch(e) {
    e.preventDefault();
    if (!finder.industry.trim()) {
      toast.error('Industry is required.');
      return;
    }
    if (!coords && !finder.location.trim()) {
      toast.error('Enter a location or use your current one.');
      return;
    }
    setSearching(true);
    try {
      const { results: found, usage: after, pages, truncatedByCap, logFailed } = await searchLeads({
        location: coords ? '' : finder.location.trim(),
        industry: finder.industry.trim(),
        maxResults: Number(finder.maxResults),
        ...(coords ? { ...coords, radius: Number(finder.radius) } : {}),
      });
      if (after) setUsage(after);
      setResults(found);
      if (logFailed) {
        toast.error("Searches aren't being logged — your monthly spend cap is not enforced.");
      } else if (found.length === 0) {
        toast.info('No businesses matched that search.');
      } else if (truncatedByCap) {
        toast.warning(`Found ${found.length} — stopped early, you hit your monthly search limit.`);
      } else {
        toast.success(`Found ${found.length} businesses (${pages} search${pages === 1 ? '' : 'es'} used).`);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSearching(false);
    }
  }

  // Call straight off a search result. Deliberately writes NOTHING here -- the lead is
  // created on save (see handleLogActivity), so cancelling the modal leaves no orphan
  // lead behind. activityLead carries just enough to title the modal.
  function logFromResult(result) {
    setPendingResult(result);
    setActivityLead({ name: result.name });
    setActivityForm({ ...emptyActivity, category: defaultCategory(categories, result.lead?.category) });
  }

  function closeActivity() {
    setActivityLead(null);
    setPendingResult(null);
  }

  function openActivity(lead) {
    setActivityLead(lead);
    setActivityForm({ ...emptyActivity, category: defaultCategory(categories, lead.category) });
  }

  // Log a cold call/message against a business that isn't in the list yet -- no Google
  // search, no billable call. The lead is created (or matched to an existing one) on save.
  function openManualLog() {
    setActivityLead({ manual: true });
    setActivityForm({ ...emptyActivity, name: '', phone: '', category: defaultCategory(categories, null) });
  }

  async function handleLogActivity(e) {
    e.preventDefault();
    if (activityLead?.manual && !activityForm.name?.trim()) {
      toast.error('Business name is required.');
      return;
    }
    if (!activityForm.outcome) {
      toast.error('Outcome is required.');
      return;
    }
    if (!activityForm.category) {
      toast.error('Category is required.');
      return;
    }
    if (activityForm.outcome === 'follow_up' && !activityForm.followUpDate) {
      toast.error('Pick a follow-up date.');
      return;
    }
    setSubmitting(true);
    try {
      // Coming from a search result, the lead is created now rather than when the modal
      // opened -- so a cancelled call log writes nothing at all.
      let leadId = activityLead.id;
      if (activityLead?.manual) {
        // Reuse an existing lead if this business is already one, otherwise create it.
        const match = findLeadMatch(leadRows, activityForm.name, activityForm.phone);
        if (match) {
          leadId = match.id;
        } else {
          const { lead } = await importOneLead({
            name: activityForm.name.trim(),
            phone: activityForm.phone.trim() || undefined,
          });
          leadId = lead.id;
        }
      } else if (pendingResult) {
        const { lead } = await importOneLead({ ...pendingResult, industry: finder.industry.trim() });
        leadId = lead.id;
      }

      const updated = await logLeadActivity(leadId, activityForm);

      if (pendingResult) {
        // Show the outcome on the row straight away, rather than spending another
        // billable search just to refresh what we already know.
        setResults((rs) =>
          rs.map((r) =>
            r.google_place_id === pendingResult.google_place_id
              ? { ...r, lead: { id: leadId, status: updated.status, lastContactedAt: new Date().toISOString() } }
              : r
          )
        );
      }

      toast.success('Contact logged.');
      closeActivity();
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function openEdit(lead) {
    setEditLead(lead);
    setEditForm({
      name: lead.name || '',
      email: lead.email || '',
      phone: lead.phone || '',
      category: lead.category || '',
      status: lead.status,
      follow_up_date: lead.follow_up_date || '',
      notes: lead.notes || '',
    });
    // Straight from supabase like the rest of the page's reads -- no new endpoint needed.
    setLeadHistory(null);
    const { data } = await supabase
      .from('lead_activities')
      .select('*')
      .eq('lead_id', lead.id)
      .order('occurred_at', { ascending: false });
    setLeadHistory(data || []);
  }

  async function handleEdit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await updateLead(editLead.id, editForm);
      toast.success('Lead updated.');
      setEditLead(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    try {
      await deleteLead(leadToDelete.id);
      toast.success('Lead deleted.');
      setLeadToDelete(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleSaveGoal(e) {
    e.preventDefault();
    if (!goalForm.name?.trim()) {
      toast.error('Give the goal a name.');
      return;
    }
    if (!(Number(goalForm.target) > 0)) {
      toast.error('Target must be greater than 0.');
      return;
    }
    // Blank is fine and means 0; a negative or non-numeric entry is not.
    if (goalForm.manualCurrent !== '' && !(Number(goalForm.manualCurrent) >= 0)) {
      toast.error('Current value must be 0 or more.');
      return;
    }

    setSubmitting(true);
    try {
      if (goalForm.id) {
        await updateLeadGoal(goalForm.id, {
          name: goalForm.name.trim(),
          target: Number(goalForm.target),
          source: goalForm.source,
          unit: goalForm.unit,
          // Cleared rather than kept when the source can't filter by it, so switching a
          // goal to a money source doesn't leave a stale category that counts nothing.
          category: (CATEGORY_FILTERABLE.includes(goalForm.source) && goalForm.category) || null,
          manual_current: Number(goalForm.manualCurrent) || 0,
          start_date: goalForm.startDate,
          due_date: goalForm.dueDate || null,
        });
      } else {
        await createLeadGoal({
          ...goalForm,
          name: goalForm.name.trim(),
          target: Number(goalForm.target),
          category: (CATEGORY_FILTERABLE.includes(goalForm.source) && goalForm.category) || '',
        });
      }
      toast.success('Goal saved.');
      setGoalForm(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // Manual count goals only -- counted goals get their number from the activity log, and
  // money goals set theirs in the form rather than a click at a time.
  async function bumpGoal(goal, delta) {
    const next = Math.max(0, Number(goal.manual_current) + delta);
    setGoals((gs) => gs.map((g) => (g.id === goal.id ? { ...g, manual_current: next, current: next } : g)));
    try {
      await updateLeadGoal(goal.id, { manual_current: next });
    } catch (err) {
      toast.error(err.message);
      load();
    }
  }

  async function toggleArchive(goal) {
    try {
      await updateLeadGoal(goal.id, { archived_at: goal.archived_at ? '' : new Date().toISOString() });
      toast.success(goal.archived_at ? 'Goal restored.' : 'Goal archived.');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function removeGoal(id) {
    try {
      await deleteLeadGoal(id);
      toast.success('Goal deleted.');
      setGoalForm(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function addCategory(e) {
    e.preventDefault();
    if (!newCategory.trim()) return;
    try {
      await createLeadCategory(newCategory.trim());
      setNewCategory('');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function removeCategory(name) {
    try {
      await deleteLeadCategory(name);
      toast.success('Category removed.');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-text-h">
          Leads{' '}
          {loading ? (
            <Skeleton className="inline-block h-3 w-16 align-middle" />
          ) : (
            <span className="text-sm font-normal text-text/70">({leadRows.length} total)</span>
          )}
        </h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowCategories(true)}>
            Categories
          </Button>
          <Button variant="secondary" onClick={() => setGoalForm({ ...emptyGoal })}>
            <Target size={16} /> New goal
          </Button>
          <Button variant="secondary" onClick={toggleFinder}>
            <Radar size={16} /> Find leads
          </Button>
          <Button onClick={openManualLog}>
            <PhoneCall size={16} /> Log contact
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={PhoneCall} label="Contacts today" value={loading ? null : stats.today} />
        <KpiCard icon={Target} label="Contacts this week" value={loading ? null : stats.week} sub={stats.breakdown} />
        <KpiCard
          icon={TrendingUp}
          label="Converted this week"
          value={loading ? null : stats.converted}
          sub={stats.week > 0 ? `${stats.rate}% of contacts` : null}
        />
        <KpiCard icon={CalendarClock} label="Follow-ups due" value={loading ? null : dueNow} />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-h">
            Goals {goals?.length > 0 && <span className="font-normal text-text/70">({goals.length})</span>}
          </h3>
          <button onClick={toggleArchived} className="text-xs text-text/60 hover:text-text-h">
            {showArchived ? 'Hide archived' : 'Show archived'}
          </button>
        </div>

        {goalsError ? (
          <Card className="border-red-500/40 bg-red-500/5 text-sm">
            <p className="font-medium text-red-600 dark:text-red-400">Goals couldn&apos;t load</p>
            <p className="mt-1 text-text/70">{goalsError}</p>
            <p className="mt-1 text-xs text-text/60">
              If this mentions a missing table or column, run <code>src/db/leads_goals_v2.sql</code> in the Supabase SQL editor.
            </p>
          </Card>
        ) : goals === null ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Card key={i} className="space-y-3">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-1.5 w-full" />
                <Skeleton className="h-3 w-20" />
              </Card>
            ))}
          </div>
        ) : goals.length === 0 ? (
          <Card className="text-center text-sm text-text/60">
            {showArchived ? 'No archived goals.' : 'No goals yet — set one to track your targets.'}
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {goals.map((g) => (
              <GoalCard
                key={g.id}
                goal={g}
                onEdit={(goal) =>
                  setGoalForm({
                    id: goal.id,
                    name: goal.name,
                    target: goal.target,
                    source: goal.source,
                    // Rows created before leads_goals_money.sql have no unit; the column
                    // defaults to 'count' server-side, so mirror that for a stale row.
                    unit: goal.unit || 'count',
                    category: goal.category || '',
                    manualCurrent: goal.manual_current ?? '',
                    startDate: goal.start_date,
                    dueDate: goal.due_date || '',
                  })
                }
                onBump={bumpGoal}
                onArchive={toggleArchive}
              />
            ))}
          </div>
        )}
      </div>

      {showFinder && (
        <Card className="space-y-4">
          <form onSubmit={handleSearch} className="flex flex-wrap items-center gap-2">
            {coords ? (
              <span className="inline-flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-text-h">
                <MapPin size={14} className="text-accent" />
                Near you
                <span className="text-xs text-text/60">
                  {coords.latitude.toFixed(3)}, {coords.longitude.toFixed(3)}
                </span>
                <button
                  type="button"
                  onClick={() => setCoords(null)}
                  className="rounded p-0.5 text-text/60 hover:bg-bg-alt hover:text-text-h"
                  title="Use a typed location instead"
                >
                  <X size={13} />
                </button>
              </span>
            ) : (
              <>
                <Input
                  placeholder="Location (e.g. Cape Town)"
                  value={finder.location}
                  onChange={(e) => setFinder({ ...finder, location: e.target.value })}
                  className="max-w-xs"
                />
                <Button type="button" variant="secondary" onClick={useMyLocation} disabled={locating}>
                  <MapPin size={16} /> {locating ? 'Locating…' : 'Use my location'}
                </Button>
              </>
            )}
            <Input
              placeholder="Industry (e.g. plumbers)"
              value={finder.industry}
              onChange={(e) => setFinder({ ...finder, industry: e.target.value })}
              className="max-w-xs"
            />
            {coords && (
              <Select
                value={finder.radius}
                onValueChange={(v) => setFinder({ ...finder, radius: v })}
                className="w-36"
              >
                <SelectItem value="5000">Within 5 km</SelectItem>
                <SelectItem value="10000">Within 10 km</SelectItem>
                <SelectItem value="25000">Within 25 km</SelectItem>
                <SelectItem value="50000">Within 50 km</SelectItem>
              </Select>
            )}
            <Select
              value={finder.maxResults}
              onValueChange={(v) => setFinder({ ...finder, maxResults: v })}
              className="w-44"
            >
              <SelectItem value="20">Up to 20 (1 search)</SelectItem>
              <SelectItem value="40">Up to 40 (2 searches)</SelectItem>
              <SelectItem value="60">Up to 60 (3 searches)</SelectItem>
            </Select>
            <Button type="submit" disabled={searching || (usage && usage.used >= usage.limit)}>
              <Search size={16} /> {searching ? 'Searching…' : 'Search'}
            </Button>
          </form>

          {/* Google caps a page at 20 and the whole query at 60, and bills per page --
              so the count is a spending choice, not just a display preference. */}
          <p className="text-xs text-text/60">
            Google returns at most 20 per page and 60 in total, and often fewer than 20 —
            each page is a separate billable search, so 60 uses 3 of your monthly allowance.
          </p>

          {usage && <SearchQuota used={usage.used} limit={usage.limit} />}

          {results.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-text/60">Filter:</span>
                {[
                  ['noWebsite', 'No website'],
                  ['hasPhone', 'Has phone'],
                  ['notContacted', 'Not contacted'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setResultFilters((f) => ({ ...f, [key]: !f[key] }))}
                    className={`rounded-full border px-2.5 py-1 transition-colors ${
                      resultFilters[key]
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border text-text/70 hover:bg-bg-alt'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <Select
                  value={resultFilters.minRating}
                  onValueChange={(v) => setResultFilters((f) => ({ ...f, minRating: v }))}
                  className="w-32"
                >
                  <SelectItem value="0">Any rating</SelectItem>
                  <SelectItem value="3">★ 3.0+</SelectItem>
                  <SelectItem value="4">★ 4.0+</SelectItem>
                </Select>
                <span className="text-text/50">
                  Showing {visibleResults.length} of {results.length}
                </span>
              </div>

              <Table>
                <Thead>
                  <Tr>
                    <Th>Business</Th>
                    <Th>Phone</Th>
                    <Th>Website</Th>
                    <Th>Rating</Th>
                    <Th>Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {visibleResults.map((r) => (
                    <Tr key={r.google_place_id} className="hover:bg-bg-alt/60">
                      <Td>
                        {/* Address is folded into the query because half of these names are
                            a franchise ("Kwikspar", "Engen"), and the bare name searches to
                            the wrong branch in another town. */}
                        {/* Flex row, not an inline space: the badge is inline-flex and was
                            baseline-aligning against a larger name, which left the dot
                            sitting low and the gap at whatever width a space happened to be. */}
                        <div className="flex items-center gap-2">
                          <a
                            href={`https://www.google.com/search?q=${encodeURIComponent(
                              [r.name, r.address].filter(Boolean).join(' ')
                            )}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-text-h hover:text-accent hover:underline"
                          >
                            {r.name}
                          </a>
                          {r.lead && <StatusBadge status={r.lead.status} className="shrink-0" />}
                        </div>
                        {r.address && <p className="mt-0.5 text-xs text-text/50">{r.address}</p>}
                        {r.lead?.lastContactedAt && (
                          <p className="mt-0.5 text-xs text-text/50">Last called {agoLabel(r.lead.lastContactedAt)}</p>
                        )}
                      </Td>
                      <Td><PhoneCell phone={r.phone} /></Td>
                      <Td>
                        {r.website ? (
                          <a href={r.website} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                            site
                          </a>
                        ) : (
                          <span className="text-emerald-600 dark:text-emerald-400">no website</span>
                        )}
                      </Td>
                      <Td>{r.rating ? `${r.rating} (${r.review_count ?? 0})` : '—'}</Td>
                      <Td>
                        <Button
                          variant="secondary"
                          className="whitespace-nowrap px-2.5 py-1 text-xs"
                          onClick={() => logFromResult(r)}
                        >
                          <PhoneCall size={13} /> {r.lead ? 'Log again' : 'Log call'}
                        </Button>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </>
          )}
        </Card>
      )}

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-h">Contacts per day</h3>
          <Select value={range} onValueChange={setRange} className="w-36">
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
          </Select>
        </div>
        <div className="h-56">
          {loading ? <Skeleton className="h-full w-full" /> : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" stroke="var(--color-text)" fontSize={11} />
              <YAxis allowDecimals={false} stroke="var(--color-text)" fontSize={12} />
              <Tooltip {...chartTooltip} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {METHODS.map((m) => (
                <Bar key={m.value} dataKey={m.value} name={m.label} stackId="a" fill={m.fill} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          )}
        </div>
      </Card>

      {followUps.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-text-h">
            Follow-ups <span className="font-normal text-text/70">(next 7 days · {followUps.length})</span>
          </h3>
          <Table>
            <Thead>
              <Tr><Th>Business</Th><Th>Phone</Th><Th>Category</Th><Th>Due</Th><Th></Th></Tr>
            </Thead>
            <Tbody>
              {followUps.map((l) => (
                <Tr key={l.id}>
                  <Td>{l.name}</Td>
                  <Td><PhoneCell phone={l.phone} /></Td>
                  <Td>{l.category || '—'}</Td>
                  <Td className={l.follow_up_date < todayStr() ? 'text-red-600 dark:text-red-400' : ''}>
                    {l.follow_up_date}
                  </Td>
                  <Td>
                    <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => openActivity(l)}>
                      Log contact
                    </Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          icon={Search}
          placeholder="Search name, phone or address…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter} className="w-44">
          <SelectItem value="all">All statuses</SelectItem>
          {STATUSES.map((s) => (
            <SelectItem key={s} value={s}>{s}</SelectItem>
          ))}
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter} className="w-44">
          <SelectItem value="all">All categories</SelectItem>
          {categories.map((c) => (
            <SelectItem key={c} value={c}>{c}</SelectItem>
          ))}
        </Select>
      </div>

      <Table>
        <Thead>
          <Tr>
            <Th>Business</Th>
            <Th>Phone</Th>
            <Th>Location</Th>
            <Th>Website</Th>
            <Th>Rating</Th>
            <Th>Category</Th>
            <Th>Status</Th>
            <Th>Follow-up</Th>
            <Th>Actions</Th>
          </Tr>
        </Thead>
        <Tbody>
          {loading && <SkeletonRows cols={9} actions />}
          {filtered.map((l) => (
            <Tr key={l.id} className="hover:bg-bg-alt/60">
              <Td className="font-medium text-text-h">{l.name}</Td>
              <Td><PhoneCell phone={l.phone} /></Td>
              <Td className="max-w-xs truncate text-text/70">{l.address || '—'}</Td>
              <Td>
                {l.website ? (
                  <a href={l.website} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    site
                  </a>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400">none</span>
                )}
              </Td>
              <Td>{l.rating ? `${l.rating} (${l.review_count ?? 0})` : '—'}</Td>
              <Td>{l.category || '—'}</Td>
              <Td><StatusBadge status={l.status} /></Td>
              <Td>{l.follow_up_date || '—'}</Td>
              <Td>
                <div className="flex gap-2">
                  <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => openActivity(l)}>
                    <PhoneCall size={13} /> Log
                  </Button>
                  <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => openEdit(l)}>
                    <Pencil size={13} />
                  </Button>
                  <Button variant="destructive" className="px-2 py-1 text-xs" onClick={() => setLeadToDelete(l)}>
                    <Trash2 size={13} />
                  </Button>
                </div>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>

      <Modal
        open={!!activityLead}
        onOpenChange={(v) => !v && closeActivity()}
        title={activityLead?.manual ? 'Log contact' : `Log contact — ${activityLead?.name || ''}`}
      >
        <form onSubmit={handleLogActivity} className="space-y-3">
          {activityLead?.manual && (
            <>
              <Input
                placeholder="Business name"
                value={activityForm.name || ''}
                onChange={(e) => setActivityForm({ ...activityForm, name: e.target.value })}
              />
              <Input
                placeholder="Phone (optional)"
                value={activityForm.phone || ''}
                onChange={(e) => setActivityForm({ ...activityForm, phone: e.target.value })}
              />
              {manualMatch && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Already a lead: “{manualMatch.name}” — this logs against it instead of creating a duplicate.
                </p>
              )}
            </>
          )}
          <Select value={activityForm.method} onValueChange={(v) => setActivityForm({ ...activityForm, method: v })}>
            {METHODS.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </Select>
          <Select
            value={activityForm.outcome}
            onValueChange={(v) => setActivityForm({ ...activityForm, outcome: v })}
            placeholder="Outcome…"
          >
            {OUTCOMES.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </Select>
          <Select
            value={activityForm.category}
            onValueChange={(v) => setActivityForm({ ...activityForm, category: v })}
            placeholder="What did you pitch?"
          >
            {categories.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </Select>
          {activityForm.outcome === 'follow_up' && (
            <Input
              type="date"
              value={activityForm.followUpDate}
              onChange={(e) => setActivityForm({ ...activityForm, followUpDate: e.target.value })}
            />
          )}
          <textarea
            placeholder="Note (optional)"
            value={activityForm.note}
            onChange={(e) => setActivityForm({ ...activityForm, note: e.target.value })}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-h placeholder:text-text/40 focus:outline-none focus:ring-2 focus:ring-accent/40"
            rows={3}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={closeActivity}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Log contact'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!editLead} onOpenChange={(v) => !v && setEditLead(null)} title="Lead details">
        <form onSubmit={handleEdit} className="space-y-3">
          <Input placeholder="Business name" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          <Input type="email" placeholder="Email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
          <Input placeholder="Phone" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
          <Select
            value={editForm.category || NO_CATEGORY}
            onValueChange={(v) => setEditForm({ ...editForm, category: v === NO_CATEGORY ? '' : v })}
          >
            <SelectItem value={NO_CATEGORY}>No category</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </Select>
          <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </Select>
          <Input
            type="date"
            value={editForm.follow_up_date}
            onChange={(e) => setEditForm({ ...editForm, follow_up_date: e.target.value })}
          />
          <textarea
            placeholder="Notes"
            value={editForm.notes}
            onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-h placeholder:text-text/40 focus:outline-none focus:ring-2 focus:ring-accent/40"
            rows={3}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEditLead(null)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
          </div>
        </form>

        <div className="mt-4 border-t border-border pt-3">
          <h4 className="mb-2 text-xs font-semibold text-text-h">Contact history</h4>
          {leadHistory === null ? (
            <p className="text-xs text-text/50">Loading…</p>
          ) : leadHistory.length === 0 ? (
            <p className="text-xs text-text/50">No contacts logged yet.</p>
          ) : (
            <ul className="max-h-56 space-y-2 overflow-y-auto">
              {leadHistory.map((a) => (
                <li key={a.id} className="text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-text-h">{METHOD_LABEL[a.method] || a.method}</span>
                    <span className="text-text/50">{agoLabel(a.occurred_at)}</span>
                  </div>
                  <p className="text-text/70">
                    {OUTCOME_LABEL[a.outcome] || a.outcome}
                    {a.category ? ` · ${a.category}` : ''}
                  </p>
                  {a.note && <p className="mt-0.5 text-text/60">{a.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      <Modal
        open={!!goalForm}
        onOpenChange={(v) => !v && setGoalForm(null)}
        title={goalForm?.id ? 'Edit goal' : 'New goal'}
      >
        {goalForm && (
          <form onSubmit={handleSaveGoal} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-text/70">Goal</label>
              <Input
                placeholder="e.g. Sign 5 website clients"
                value={goalForm.name}
                onChange={(e) => setGoalForm({ ...goalForm, name: e.target.value })}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-text/70">Measured by</label>
              <Select
                value={goalForm.source}
                onValueChange={(v) =>
                  setGoalForm({
                    ...goalForm,
                    source: v,
                    // Follow the source unless you've already overridden it -- picking a
                    // money source should just make the goal money, but choosing "I
                    // update it myself" afterwards must not silently reset it to counts.
                    unit: GOAL_SOURCES.find((s) => s.value === v)?.currency
                      ? 'currency'
                      : goalForm.unit,
                  })
                }
              >
                {GOAL_SOURCES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </Select>
              {sourceNote && <p className="mt-1 text-xs text-text/50">{sourceNote}</p>}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-text/70">Target</label>
                <Input
                  type="number"
                  min={goalForm.unit === 'currency' ? '0.01' : '1'}
                  step={goalForm.unit === 'currency' ? '0.01' : '1'}
                  placeholder={goalForm.unit === 'currency' ? '20000' : '5'}
                  value={goalForm.target}
                  onChange={(e) => setGoalForm({ ...goalForm, target: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-text/70">Counts in</label>
                <Select value={goalForm.unit} onValueChange={(v) => setGoalForm({ ...goalForm, unit: v })}>
                  <SelectItem value="count">Things (5, 20…)</SelectItem>
                  <SelectItem value="currency">Rands (R20 000…)</SelectItem>
                </Select>
              </div>
            </div>

            {/* Only a manual goal has a value to set -- every other source derives it, and
                an editable box there would imply you could overrule the activity log. */}
            {goalForm.source === 'manual' && (
              <div>
                <label className="mb-1 block text-xs text-text/70">Current value</label>
                <Input
                  type="number"
                  min="0"
                  step={goalForm.unit === 'currency' ? '0.01' : '1'}
                  placeholder="0"
                  value={goalForm.manualCurrent}
                  onChange={(e) => setGoalForm({ ...goalForm, manualCurrent: e.target.value })}
                />
                <p className="mt-1 text-xs text-text/50">
                  Where you are now, out of {goalForm.target || 'the target'}. This is the only
                  place it changes — nothing counts it for you.
                </p>
              </div>
            )}

            {/* Only the lead-counting sources can filter by category: the ledger keeps its
                own free-text categories and invoices have none at all, so showing this
                against a money source would offer a filter that matches nothing. */}
            {CATEGORY_FILTERABLE.includes(goalForm.source) && (
              <div>
                <label className="mb-1 block text-xs text-text/70">
                  Category <span className="text-text/50">(optional — limits what counts)</span>
                </label>
                <Select
                  value={goalForm.category || NO_CATEGORY}
                  onValueChange={(v) => setGoalForm({ ...goalForm, category: v === NO_CATEGORY ? '' : v })}
                >
                  <SelectItem value={NO_CATEGORY}>Any category</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </Select>
                {categories.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    No categories yet — add them with the Categories button.
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-text/70">Counting from</label>
                <Input
                  type="date"
                  value={goalForm.startDate}
                  onChange={(e) => setGoalForm({ ...goalForm, startDate: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-text/70">Due date</label>
                <Input
                  type="date"
                  value={goalForm.dueDate}
                  onChange={(e) => setGoalForm({ ...goalForm, dueDate: e.target.value })}
                />
              </div>
            </div>

            <div className="flex justify-between gap-2 pt-2">
              {goalForm.id ? (
                <Button type="button" variant="destructive" onClick={() => removeGoal(goalForm.id)}>
                  <Trash2 size={14} /> Delete
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setGoalForm(null)}>Cancel</Button>
                <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save goal'}</Button>
              </div>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={showCategories} onOpenChange={setShowCategories} title="Campaign categories">
        <div className="space-y-3">
          <p className="text-xs text-text/60">
            What you pitch. Used to tag leads and contacts, and to narrow what a goal counts.
          </p>
          {categories.map((c) => (
            <div key={c} className="flex items-center gap-2">
              <span className="flex-1 text-sm text-text-h">{c}</span>
              <Button variant="destructive" className="px-2 py-1 text-xs" onClick={() => removeCategory(c)}>
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
          <form onSubmit={addCategory} className="flex items-center gap-2 border-t border-border pt-3">
            <Input
              placeholder="New category"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="flex-1"
            />
            <Button type="submit"><Plus size={16} /></Button>
          </form>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!leadToDelete}
        onOpenChange={(v) => !v && setLeadToDelete(null)}
        title="Delete lead?"
        description={`${leadToDelete?.name} and its contact history will be permanently removed.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}
