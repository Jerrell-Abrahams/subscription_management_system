import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ExternalLink, Pencil, PauseCircle, PlayCircle, Trash2, Plus, Search } from 'lucide-react';
import { supabase } from '../supabaseClient';
import {
  createUser,
  createWebsite,
  updateWebsite,
  updateSubscription,
  deleteWebsite,
  suspendSubscription,
  renewSubscription,
} from '../adminApi';
import { Button, IconButton } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../components/ui/DropdownMenu';
import { Modal } from '../components/ui/Modal';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { Skeleton, SkeletonRows } from '../components/ui/Skeleton';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { Field, Input } from '../components/ui/Input';
import { Select, SelectItem } from '../components/ui/Select';

const emptyForm = {
  userId: '',
  domain: '',
  billingInterval: 'monthly',
  isNewUser: false,
  newEmail: '',
  newPassword: '',
  newFullName: '',
};

// Order is deliberate: client first, because it is the only kind that earns money.
const KINDS = ['client', 'demo', 'internal'];

// Mirrors the status check constraint on subscriptions in src/db/schema.sql.
const SUB_STATUSES = ['pending', 'active', 'past_due', 'canceled', 'expired', 'revoked'];

// Hand-drawn rather than lucide's MoreHorizontal: that icon spaces its dots 7 units apart
// in a 24-unit box, so the dots can only ever be a small fraction of the icon and no `size`
// fixes it. Three spans give an exact diameter, and bg-current keeps the button's hover and
// disabled colours working. 4px: lucide's ~2.7px read too faint, 7px too heavy.
function DotsIcon() {
  return (
    <span className="flex items-center gap-[3px]" aria-hidden>
      <span className="h-[4px] w-[4px] rounded-full bg-current" />
      <span className="h-[4px] w-[4px] rounded-full bg-current" />
      <span className="h-[4px] w-[4px] rounded-full bg-current" />
    </span>
  );
}

export function Websites() {
  const [websites, setWebsites] = useState(null); // null = not loaded, [] = loaded empty
  const [users, setUsers] = useState([]); // only feeds the modal owner pickers; no skeleton
  const [kind, setKind] = useState('all');
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null); // { id, domain, kind }
  const [toDelete, setToDelete] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);

  // Surfaced rather than swallowed, matching Finance and Leads: an empty table and a
  // failed query look identical otherwise, which hides an unrun migration behind
  // "no websites yet".
  async function load() {
    const [{ data: siteRows, error }, { data: userRows }] = await Promise.all([
      supabase
        .from('websites')
        .select(
          'id, domain, kind, created_at, subscriptions(id, user_id, status, current_period_end, billing_interval, app_users(email))'
        )
        // kind first ('client' sorts before 'demo'/'internal'), so 20 demos imported on the
        // same day can't bury the handful of rows that are actually paying.
        .order('kind', { ascending: true })
        .order('created_at', { ascending: false }),
      supabase.from('app_users').select('id, email').order('email'),
    ]);
    if (error) {
      setLoadError(error.message);
      return;
    }
    setLoadError(null);
    setWebsites(siteRows || []);
    setUsers(userRows || []);
  }

  useEffect(() => {
    load();
  }, []);

  const loading = websites === null;
  const rows = websites ?? [];

  const filtered = rows.filter((w) => {
    if (kind !== 'all' && (w.kind || 'client') !== kind) return false;
    const q = search.toLowerCase();
    return w.domain?.toLowerCase().includes(q) || w.subscriptions?.app_users?.email?.toLowerCase().includes(q);
  });

  const countOf = (k) => rows.filter((w) => (w.kind || 'client') === k).length;
  // Deliberately client-only: this line answers "how many people are paying me", and 20
  // demos in the total would drown that out.
  const liveCount = rows.filter(
    (w) => (w.kind || 'client') === 'client' && w.subscriptions?.status === 'active'
  ).length;

  async function handleCreate(e) {
    e.preventDefault();

    if (!form.domain.trim()) {
      toast.error('Domain is required.');
      return;
    }
    if (form.isNewUser ? !form.newEmail || !form.newPassword : !form.userId) {
      toast.error(form.isNewUser ? 'Email and password are required.' : 'User is required.');
      return;
    }

    setSubmitting(true);
    try {
      const userId = form.isNewUser
        ? (await createUser({ email: form.newEmail, password: form.newPassword, fullName: form.newFullName })).id
        : form.userId;

      await createWebsite({ userId, domain: form.domain.trim(), billingInterval: form.billingInterval });

      toast.success('Website registered.');
      setShowForm(false);
      setForm(emptyForm);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEdit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      // Subscription first: it carries the fields most likely to be rejected (a bad date, a
      // missing owner), and failing before the website write leaves nothing half-applied.
      if (editing.subId) {
        await updateSubscription(editing.subId, {
          userId: editing.userId,
          status: editing.status,
          billingInterval: editing.billingInterval,
          currentPeriodEnd: editing.periodEnd,
        });
      }
      await updateWebsite(editing.id, { domain: editing.domain.trim(), kind: editing.kind });
      toast.success('Website updated.');
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    try {
      await deleteWebsite(toDelete.id);
      toast.success('Website removed.');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setToDelete(null);
    }
  }

  async function handleToggle(w) {
    const sub = w.subscriptions;
    if (!sub) return;
    const suspend = sub.status === 'active';
    setBusyId(w.id);
    try {
      await (suspend ? suspendSubscription(sub.id) : renewSubscription(sub.id));
      toast.success(suspend ? 'Website suspended.' : 'Website reactivated.');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-text-h">Websites</h2>
        <Card className="border-red-500/40 bg-red-500/5 text-sm">
          <p className="font-medium text-red-600 dark:text-red-400">Websites couldn&apos;t load</p>
          <p className="mt-1 text-text/70">{loadError}</p>
          <p className="mt-1 text-xs text-text/60">
            If this mentions a missing table or column, run <code>src/db/website_kinds.sql</code> in the
            Supabase SQL editor.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-text-h">
          Websites{' '}
          {loading ? (
            <Skeleton className="inline-block h-3 w-44 align-middle" />
          ) : (
            <span className="text-sm font-normal text-text/70">
              ({countOf('client')} client, {liveCount} live · {countOf('demo')} demo)
            </span>
          )}
        </h2>
        <Button onClick={() => setShowForm(true)}>
          <Plus size={16} /> Add website
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {['all', ...KINDS].map((k) => (
          <Button
            key={k}
            variant={kind === k ? 'primary' : 'secondary'}
            className="h-[30px] px-3 text-[12px]"
            onClick={() => setKind(k)}
          >
            {k === 'all' ? `All ${rows.length}` : `${k} ${countOf(k)}`}
          </Button>
        ))}

        <Input
          icon={Search}
          placeholder="Search by domain or owner…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto h-[30px] max-w-xs"
        />
      </div>

      <Table>
        <Thead>
          <Tr>
            <Th>Domain</Th>
            <Th>Kind</Th>
            <Th>Owner</Th>
            <Th>Status</Th>
            <Th>Billing</Th>
            <Th>Period end</Th>
            <Th>Actions</Th>
          </Tr>
        </Thead>
        <Tbody>
          {loading && <SkeletonRows cols={7} actions />}
          {filtered.map((w) => {
            const sub = w.subscriptions;
            const isLive = sub?.status === 'active';
            const isClient = (w.kind || 'client') === 'client';
            // A demo has no owner, status, billing or period by design. Rendering those
            // cells as '—' would read as missing data; n/a says "never applies here".
            const na = <span className="text-dim">n/a</span>;
            return (
              <Tr key={w.id} className="hover:bg-bg-alt/60">
                <Td>
                  {sub ? (
                    <Link to={`/subscriptions/${sub.id}`} className="text-accent hover:underline">{w.domain}</Link>
                  ) : (
                    <a href={`https://${w.domain}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      {w.domain}
                    </a>
                  )}
                </Td>
                <Td><Badge>{w.kind || 'client'}</Badge></Td>
                <Td>{isClient ? sub?.app_users?.email : na}</Td>
                <Td>{sub ? <StatusBadge status={sub.status} /> : na}</Td>
                <Td>{isClient ? sub?.billing_interval : na}</Td>
                <Td>{sub ? new Date(sub.current_period_end).toLocaleDateString() : na}</Td>
                <Td>
                  <div className="flex justify-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          aria-label={`Actions for ${w.domain}`}
                          disabled={busyId === w.id}
                          className="h-9 w-9"
                        >
                          <DotsIcon />
                        </IconButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <a
                            href={`https://${w.domain}`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 text-text"
                          >
                            <ExternalLink size={15} /> Open site
                          </a>
                        </DropdownMenuItem>

                        <DropdownMenuItem
                          className="flex items-center gap-2"
                          onSelect={() =>
                            setEditing({
                              id: w.id,
                              domain: w.domain,
                              kind: w.kind || 'client',
                              subId: sub?.id || null,
                              userId: sub?.user_id || '',
                              status: sub?.status || '',
                              billingInterval: sub?.billing_interval || 'monthly',
                              // <input type="date"> only accepts YYYY-MM-DD, never an ISO timestamp.
                              periodEnd: sub?.current_period_end?.slice(0, 10) || '',
                            })
                          }
                        >
                          <Pencil size={15} /> Edit
                        </DropdownMenuItem>

                        {/* Suspend/reactivate is billing, so it only exists where billing does. */}
                        {isClient && sub && (
                          <DropdownMenuItem className="flex items-center gap-2" onSelect={() => handleToggle(w)}>
                            {isLive ? <PauseCircle size={15} /> : <PlayCircle size={15} />}
                            {isLive ? 'Suspend' : 'Reactivate'}
                          </DropdownMenuItem>
                        )}

                        <DropdownMenuItem
                          className="flex items-center gap-2 text-bad"
                          onSelect={() => setToDelete(w)}
                        >
                          <Trash2 size={15} /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>

      <Modal open={!!editing} onOpenChange={(v) => !v && setEditing(null)} title="Edit website">
        {editing && (
          <form onSubmit={handleEdit} className="space-y-3">
            <Field label="Domain">
              <Input
                value={editing.domain}
                onChange={(e) => setEditing({ ...editing, domain: e.target.value })}
                required
              />
            </Field>

            <Field
              label="Kind"
              hint={
                <>
                  Only a client site is gated on billing. Demo and internal sites always serve, and
                  switching a site to client needs a subscription it doesn&apos;t have — add those from
                  &ldquo;Add website&rdquo;.
                </>
              }
            >
              <Select value={editing.kind} onValueChange={(v) => setEditing({ ...editing, kind: v })}>
                {KINDS.map((k) => (
                  <SelectItem key={k} value={k}>{k}</SelectItem>
                ))}
              </Select>
            </Field>

            {/* Owner/status/billing/period live on the subscription, not the website, so they
                only exist for a site that has one. Saving writes to both tables. */}
            {editing.subId ? (
              <div className="space-y-3 border-t border-border pt-3">
                <p className="text-xs text-text/50">
                  These four are on the subscription, shared with the Subscriptions tab — a change
                  here shows up there too.
                </p>

                <Field label="Owner">
                  <Select value={editing.userId} onValueChange={(v) => setEditing({ ...editing, userId: v })}>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.email}</SelectItem>
                    ))}
                  </Select>
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Status">
                    <Select value={editing.status} onValueChange={(v) => setEditing({ ...editing, status: v })}>
                      {SUB_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Billing">
                    <Select
                      value={editing.billingInterval}
                      onValueChange={(v) => setEditing({ ...editing, billingInterval: v })}
                    >
                      <SelectItem value="monthly">monthly</SelectItem>
                      <SelectItem value="yearly">yearly</SelectItem>
                    </Select>
                  </Field>
                </div>

                <Field
                  label="Period end"
                  hint="A client site stops serving once this date passes, even while the status still reads active."
                >
                  <Input
                    type="date"
                    value={editing.periodEnd}
                    onChange={(e) => setEditing({ ...editing, periodEnd: e.target.value })}
                  />
                </Field>
              </div>
            ) : (
              <p className="border-t border-border pt-3 text-xs text-text/50">
                Owner, status, billing and period end belong to a subscription. This site has none —
                that is what makes it a {editing.kind} rather than a client.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        title={`Remove ${toDelete?.domain}?`}
        description={
          toDelete?.subscriptions
            ? 'This unregisters the domain only. Its subscription and invoices are left untouched, and the site stops being gated — it will serve again even if the subscription lapses.'
            : 'This removes the domain from the list. Nothing else is affected.'
        }
        confirmLabel="Remove"
        destructive
        onConfirm={handleDelete}
      />

      <Modal open={showForm} onOpenChange={setShowForm} title="Add website">
        <form onSubmit={handleCreate} className="space-y-3">
          {/* as="div": this group holds a checkbox and then either a select or three inputs,
              and a <label> may only own one control. */}
          <Field
            as="div"
            label="Owner"
            hint={
              form.isNewUser
                ? 'Nothing is emailed — note the password below and send it to them yourself.'
                : 'The customer this site is billed to.'
            }
          >
            <label className="flex items-center gap-2 text-[13px] font-normal text-text">
              <input
                type="checkbox"
                checked={form.isNewUser}
                onChange={(e) => setForm({ ...form, isNewUser: e.target.checked })}
              />
              New customer
            </label>

            {form.isNewUser ? (
              <div className="space-y-2">
                <Input type="email" placeholder="Email" value={form.newEmail} onChange={(e) => setForm({ ...form, newEmail: e.target.value })} required />
                <Input placeholder="Password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} required />
                <Input placeholder="Full name (optional)" value={form.newFullName} onChange={(e) => setForm({ ...form, newFullName: e.target.value })} />
              </div>
            ) : (
              <Select value={form.userId} onValueChange={(v) => setForm({ ...form, userId: v })} placeholder="Select customer…">
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.email}</SelectItem>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Domain" hint="No http:// or www — just the domain the site serves on.">
            <Input
              placeholder="example.com"
              value={form.domain}
              onChange={(e) => setForm({ ...form, domain: e.target.value })}
              required
            />
          </Field>

          {/* createWebsite always makes a client site with a subscription -- there is no kind
              picker here because demo and internal are reached by switching Kind in Edit. The
              hint says so, since the billing consequence is the whole point of the record. */}
          <Field
            label="Billing"
            hint="Registers a client site: it stops serving once the subscription lapses. For a demo or internal site, add it here then switch Kind under Edit."
          >
            <Select value={form.billingInterval} onValueChange={(v) => setForm({ ...form, billingInterval: v })}>
              <SelectItem value="monthly">monthly</SelectItem>
              <SelectItem value="yearly">yearly</SelectItem>
            </Select>
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? 'Adding…' : 'Add website'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
