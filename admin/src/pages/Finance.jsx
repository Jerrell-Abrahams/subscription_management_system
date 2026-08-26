import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDownLeft, ArrowUpRight, Pencil, Plus, RefreshCw, Scale, Trash2, Wallet } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase } from '../supabaseClient';
import { syncPaystack } from '../adminApi';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Field, Input } from '../components/ui/Input';
import { Select, SelectItem } from '../components/ui/Select';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { Skeleton, SkeletonRows } from '../components/ui/Skeleton';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { chartTooltip } from '../lib/chart';
import { money, day, today, parseLocalDate } from '../lib/format';
import { monthTotals, spendByCategory, runningBalance, usedCategories, canonicalCategory } from '../lib/finance';

const emptyEntry = () => ({ occurred_on: today(), direction: 'out', amount: '', category: '', description: '' });

// 'YYYY-MM' -> 'August 2026'.
const monthLabel = (month) => parseLocalDate(`${month}-01`).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });

function KpiCard({ icon: Icon, label, value, sub, tone, onClick }) {
  return (
    <Card
      className={`flex items-center gap-3${onClick ? ' cursor-pointer hover:border-border-2' : ''}`}
      onClick={onClick}
      title={onClick ? 'Set the opening balance' : undefined}
    >
      <div className="rounded-lg bg-accent/10 p-2 text-accent">
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-text/70">{label}</p>
        {value === null ? (
          <Skeleton className="mt-1.5 h-5 w-24" />
        ) : (
          <p className={`text-xl font-semibold ${tone || 'text-text-h'}`}>{value}</p>
        )}
        {sub && <p className="text-xs text-text/60">{sub}</p>}
      </div>
    </Card>
  );
}

export function Finance() {
  // null = not loaded, [] = loaded and empty. The distinction is the whole point here:
  // this screen used to render "No entries for August 2026" while the query was still in
  // flight, which is indistinguishable from an actually empty ledger.
  const [entries, setEntries] = useState(null);
  const [settings, setSettings] = useState({});
  const [loadError, setLoadError] = useState(null);
  const [month, setMonth] = useState(today().slice(0, 7));

  const [entryForm, setEntryForm] = useState(null); // null = closed, {} = new, {id} = editing
  const [balanceForm, setBalanceForm] = useState(null);
  const [entryToDelete, setEntryToDelete] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // Its own flag rather than sharing `submitting`: saving an entry would otherwise flip the
  // Sync button to "Syncing…" behind the open modal.
  const [syncing, setSyncing] = useState(false);

  // ponytail: loads every entry on every page view. The running balance is cumulative from
  // the opening date, so there is no smaller query that is still correct, and the category
  // datalist needs all-time values. Add a date filter plus a server-side balance if this
  // ever passes a few thousand rows.
  async function load() {
    const [{ data: rows, error }, { data: config }] = await Promise.all([
      supabase.from('finance_entries').select('*').order('occurred_on', { ascending: false }),
      supabase.from('app_settings').select('opening_balance, opening_balance_date').maybeSingle(),
    ]);
    // Surfaced rather than swallowed: an empty ledger and a missing table look identical
    // otherwise, which hides an unrun migration behind "no entries yet".
    if (error) {
      setLoadError(error.message);
      return;
    }
    setLoadError(null);
    setEntries(rows || []);
    setSettings(config || {});
  }

  useEffect(() => {
    load();
  }, []);

  const asOf = today();
  const loading = entries === null;
  // Memoised rather than `entries ?? []` inline: a fresh [] on every render would blow the
  // dependency array of every memo below.
  const rows = useMemo(() => entries ?? [], [entries]);

  const cats = useMemo(() => usedCategories(rows), [rows]);
  const totals = useMemo(() => monthTotals(rows, month), [rows, month]);
  const spend = useMemo(() => spendByCategory(rows, month), [rows, month]);
  const monthEntries = useMemo(
    () => rows.filter((e) => e.occurred_on.slice(0, 7) === month),
    [rows, month]
  );
  const balance = useMemo(
    () =>
      runningBalance(rows, {
        openingBalance: settings.opening_balance,
        openingDate: settings.opening_balance_date,
        asOf,
      }),
    [rows, settings, asOf]
  );

  // An imported row's money came from the provider and is more trustworthy than a retype,
  // so only the two fields a human actually improves are sent. Enforced here as well as by
  // the disabled inputs -- a disabled field is a UI courtesy, not a rule.
  //
  // Keyed on `source` rather than on a provider name, so it covers the live Paystack rows
  // and the historical Payfast ones the same way.
  const synced = !!entryForm?.source;

  async function saveEntry(e) {
    e.preventDefault();
    if (!synced && !(Number(entryForm.amount) > 0)) {
      toast.error('Amount must be more than zero.');
      return;
    }
    const row = synced
      ? {
          category: canonicalCategory(entryForm.category, cats),
          description: entryForm.description.trim() || null,
        }
      : {
          occurred_on: entryForm.occurred_on,
          direction: entryForm.direction,
          amount: Number(entryForm.amount),
          category: canonicalCategory(entryForm.category, cats),
          description: entryForm.description.trim() || null,
        };
    setSubmitting(true);
    const { error } = entryForm.id
      ? await supabase.from('finance_entries').update(row).eq('id', entryForm.id)
      : await supabase.from('finance_entries').insert(row);
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(entryForm.id ? 'Entry updated.' : 'Entry added.');
    setEntryForm(null);
    load();
  }

  async function saveOpeningBalance(e) {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase
      .from('app_settings')
      .update({
        opening_balance: balanceForm.opening_balance === '' ? null : Number(balanceForm.opening_balance),
        opening_balance_date: balanceForm.opening_balance_date || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', true);
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Opening balance saved.');
    setBalanceForm(null);
    load();
  }

  // No date-range dialog: the server's 90-day default is the only window worth asking for,
  // and this button exists for "I was just paid, show me now" -- which a form in the way
  // does not serve. The nightly cron covers everything else.
  async function runSync() {
    setSyncing(true);
    try {
      const { found, imported } = await syncPaystack();
      // "found 12, imported 0" is the normal result of a second sync, and reads as working
      // rather than broken. "found 0" on an account you believe has payments is the signal
      // that Paystack, not the ledger, is where to look.
      toast.success(
        found === 0
          ? 'No Paystack payments in the last 90 days.'
          : `${imported} new ${imported === 1 ? 'entry' : 'entries'} from ${found} Paystack payment(s).`
      );
      load();
    } catch (err) {
      toast.error(err.message);
    }
    setSyncing(false);
  }

  async function deleteEntry() {
    const { error } = await supabase.from('finance_entries').delete().eq('id', entryToDelete.id);
    setEntryToDelete(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Entry deleted.');
    load();
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-text-h">Finance</h2>
        <Card className="border-red-500/40 bg-red-500/5 text-sm">
          <p className="font-medium text-red-600 dark:text-red-400">The ledger couldn&apos;t load</p>
          <p className="mt-1 text-text/70">{loadError}</p>
          <p className="mt-1 text-xs text-text/60">
            If this mentions a missing table or column, run <code>src/db/finance.sql</code> in the Supabase SQL editor.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-text-h">Finance</h2>
        <div className="flex flex-wrap items-center gap-2">
          {/* Safari has no type="month" and falls back to a text box -- the pattern keeps
              that fallback usable rather than silently accepting anything. */}
          <Input
            type="month"
            pattern="\d{4}-\d{2}"
            placeholder="2026-08"
            className="w-40"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
          {/* h-[34px]/px-3.5: matches the month field beside it. At the default h-8 the
              button sits 2px short of the input and reads as cramped next to it. */}
          <Button variant="secondary" className="h-[34px] px-3.5" disabled={syncing} onClick={runSync}>
            <RefreshCw size={16} className={syncing ? 'animate-spin' : undefined} />
            {syncing ? 'Syncing…' : 'Sync Paystack'}
          </Button>
          <Button className="h-[34px] px-3.5" onClick={() => setEntryForm(emptyEntry())}>
            <Plus size={16} /> Add entry
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={ArrowDownLeft}
          label={`Money in — ${monthLabel(month)}`}
          value={loading ? null : money(totals.in)}
          tone="text-emerald-600 dark:text-emerald-400"
        />
        <KpiCard
          icon={ArrowUpRight}
          label={`Money out — ${monthLabel(month)}`}
          value={loading ? null : money(totals.out)}
          tone="text-red-600 dark:text-red-400"
        />
        <KpiCard
          icon={Scale}
          label="Net"
          value={loading ? null : money(totals.net)}
          tone={totals.net < 0 ? 'text-red-600 dark:text-red-400' : 'text-text-h'}
        />
        {/* Deliberately NOT windowed by the month picker: this number exists to be checked
            against your banking app, and "balance at the end of March" is a different,
            more confusing thing. The label has to say so.

            Clicking it opens the opening-balance dialog. That trigger had gone missing, so
            the balance read '—' with nothing on the page able to fix it. The card itself is
            the trigger rather than a fourth toolbar button: it is the only thing on screen
            the setting affects, and its own sub-label already tells you to set one. */}
        <KpiCard
          icon={Wallet}
          label="Balance today"
          onClick={() =>
            setBalanceForm({
              opening_balance: settings.opening_balance ?? '',
              opening_balance_date: settings.opening_balance_date ?? '',
            })
          }
          value={loading ? null : balance.balance == null ? '—' : money(balance.balance)}
          sub={
            loading
              ? null
              : balance.balance == null
              ? 'Set an opening balance to track this'
              : [
                  balance.future > 0 &&
                    `${money(balance.projected)} once ${balance.future} future-dated ${
                      balance.future === 1 ? 'entry clears' : 'entries clear'
                    }`,
                  balance.ignoredBefore > 0 &&
                    `${balance.ignoredBefore} ${
                      balance.ignoredBefore === 1 ? 'entry predates' : 'entries predate'
                    } your opening date and ${balance.ignoredBefore === 1 ? "isn't" : "aren't"} counted`,
                ]
                  .filter(Boolean)
                  .join(' · ') || null
          }
        />
      </div>

      {spend.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-text-h">Spend by category — {monthLabel(month)}</h3>
          <div style={{ height: Math.max(160, spend.length * 44) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={spend} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                <XAxis type="number" stroke="var(--color-text)" fontSize={12} />
                <YAxis type="category" dataKey="category" width={110} stroke="var(--color-text)" fontSize={12} />
                <Tooltip {...chartTooltip} formatter={(value) => money(value)} />
                <Bar dataKey="amount" fill="var(--color-accent)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {!loading && monthEntries.length === 0 ? (
        <Card className="text-center text-sm text-text/60">No entries for {monthLabel(month)}.</Card>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Date</Th>
              <Th>Description</Th>
              <Th>Category</Th>
              <Th>In</Th>
              <Th>Out</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {loading && <SkeletonRows cols={6} actions />}
            {monthEntries.map((e) => (
              <Tr key={e.id}>
                <Td className="whitespace-nowrap">{day(e.occurred_on)}</Td>
                <Td>
                  <span className="inline-flex items-center gap-2">
                    {e.description || '—'}
                    {/* Where the number came from, on the row where you'd doubt it. Also the
                        visible half of the edit lock -- a badged row won't let you retype
                        its amount. */}
                    {e.source && <Badge className="capitalize">{e.source}</Badge>}
                  </span>
                </Td>
                <Td>{e.category || '—'}</Td>
                <Td className="whitespace-nowrap text-emerald-600 dark:text-emerald-400">
                  {e.direction === 'in' ? money(e.amount) : '—'}
                </Td>
                <Td className="whitespace-nowrap text-red-600 dark:text-red-400">
                  {e.direction === 'out' ? money(e.amount) : '—'}
                </Td>
                <Td>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setEntryForm({
                          ...e,
                          amount: e.amount ?? '',
                          category: e.category ?? '',
                          description: e.description ?? '',
                        })
                      }
                    >
                      <Pencil size={14} /> Edit
                    </Button>
                    <Button variant="destructive" onClick={() => setEntryToDelete(e)}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      <Modal
        open={!!entryForm}
        onOpenChange={(open) => !open && setEntryForm(null)}
        title={entryForm?.id ? 'Edit entry' : 'Add entry'}
      >
        {entryForm && (
          <form className="space-y-3" onSubmit={saveEntry}>
            {synced && (
              <p className="rounded-md border border-border bg-raised px-3 py-2 text-xs text-text/70">
                Pulled from <span className="capitalize">{entryForm.source}</span>. The date, direction and amount
                are theirs — categorise it however you like, but those three stay as reported.
              </p>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Date">
                <Input
                  type="date"
                  required
                  disabled={synced}
                  value={entryForm.occurred_on}
                  onChange={(ev) => setEntryForm({ ...entryForm, occurred_on: ev.target.value })}
                />
              </Field>
              <Field label="Direction">
                <Select
                  value={entryForm.direction}
                  disabled={synced}
                  onValueChange={(v) => setEntryForm({ ...entryForm, direction: v })}
                >
                  <SelectItem value="out">Money out</SelectItem>
                  <SelectItem value="in">Money in</SelectItem>
                </Select>
              </Field>
            </div>

            <Field label="Amount (ZAR)">
              <Input
                type="number"
                step="0.01"
                min="0.01"
                required
                disabled={synced}
                placeholder="250.00"
                value={entryForm.amount}
                onChange={(ev) => setEntryForm({ ...entryForm, amount: ev.target.value })}
              />
            </Field>

            <Field
              label="Category"
              hint="Free text. Typing one you've used before in a different case snaps to the existing spelling."
            >
              <Input
                list="finance-categories"
                placeholder="e.g. Hosting"
                value={entryForm.category}
                onChange={(ev) => setEntryForm({ ...entryForm, category: ev.target.value })}
              />
              <datalist id="finance-categories">
                {cats.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>

            <Field label="Description">
              <Input
                placeholder="As it reads on your statement"
                value={entryForm.description}
                onChange={(ev) => setEntryForm({ ...entryForm, description: ev.target.value })}
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setEntryForm(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving…' : 'Save entry'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!balanceForm} onOpenChange={(open) => !open && setBalanceForm(null)} title="Opening balance">
        {balanceForm && (
          <form className="space-y-3" onSubmit={saveOpeningBalance}>
            <p className="text-sm text-text/70">
              The ledger can&apos;t know what was already in the account before your first entry. Take both figures
              straight off a bank statement.
            </p>
            <Field label="Balance (ZAR)">
              <Input
                type="number"
                step="0.01"
                placeholder="12480.50"
                value={balanceForm.opening_balance}
                onChange={(ev) => setBalanceForm({ ...balanceForm, opening_balance: ev.target.value })}
              />
            </Field>
            <Field
              label="Balance in your account at the START of this day"
              hint="Entries dated on this day count towards the balance. Anything earlier is treated as already included in the figure above."
            >
              <Input
                type="date"
                value={balanceForm.opening_balance_date}
                onChange={(ev) => setBalanceForm({ ...balanceForm, opening_balance_date: ev.target.value })}
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setBalanceForm(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!entryToDelete}
        onOpenChange={(open) => !open && setEntryToDelete(null)}
        title="Delete entry?"
        description={
          entryToDelete
            ? `${money(entryToDelete.amount)} ${entryToDelete.direction === 'in' ? 'in' : 'out'} on ${day(
                entryToDelete.occurred_on
              )} will be permanently removed.`
            : ''
        }
        confirmLabel="Delete"
        destructive
        onConfirm={deleteEntry}
      />
    </div>
  );
}
