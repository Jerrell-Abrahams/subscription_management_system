import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Search } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { createUser, createSubscription, provisionRestaurant } from '../adminApi';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { Skeleton, SkeletonRows } from '../components/ui/Skeleton';
import { StatusBadge } from '../components/ui/Badge';
import { Field, Input } from '../components/ui/Input';
import { Select, SelectItem } from '../components/ui/Select';

const emptyForm = {
  userId: '',
  productId: '',
  billingInterval: 'monthly',
  maxActivations: 1,
  isNewUser: false,
  newEmail: '',
  newPassword: '',
  newFullName: '',
  // Only used when the selected product is "restaurant" -- the owner's login lives in a
  // different Supabase project entirely (see restaurantProvision.js), so it always needs its
  // own email/password regardless of whether the billing customer above is new or existing.
  restaurantName: '',
  restaurantSlug: '',
  restaurantEmail: '',
  restaurantPassword: '',
};

export function Subscriptions() {
  const [searchParams] = useSearchParams();
  const [subscriptions, setSubscriptions] = useState(null); // null = not loaded, [] = loaded empty
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  // Set only when billing succeeded but provisioning the restaurant owner's login failed.
  // { subscriptionId, payload, message } -- enough to retry just that step, since the
  // restaurant repo's endpoint is idempotent on subscriptionId and re-running createUser /
  // createSubscription would create a second app_user or a second subscription.
  const [provisionError, setProvisionError] = useState(null);

  async function load() {
    const [{ data: subRows }, { data: userRows }, { data: productRows }] = await Promise.all([
      supabase
        .from('subscriptions')
        .select('id, status, max_activations, current_activations, current_period_end, billing_interval, app_users(email), products(name)')
        .order('created_at', { ascending: false }),
      supabase.from('app_users').select('id, email').order('email'),
      supabase.from('products').select('id, name, slug').order('name'),
    ]);
    setSubscriptions(subRows || []);
    setUsers(userRows || []);
    setProducts(productRows || []);

    const userFilter = searchParams.get('user');
    if (userFilter) {
      const match = (userRows || []).find((u) => u.id === userFilter);
      if (match) setSearch(match.email);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loading = subscriptions === null;
  const rows = subscriptions ?? [];

  const filtered = rows.filter((s) => {
    const q = search.toLowerCase();
    return (
      s.app_users?.email?.toLowerCase().includes(q) ||
      s.products?.name?.toLowerCase().includes(q)
    );
  });

  const activeCount = rows.filter((s) => s.status === 'active').length;

  // slug, not name: names can repeat/change, and the restaurant repo's endpoint is keyed on
  // this exact string.
  const isRestaurant = products.find((p) => p.id === form.productId)?.slug === 'restaurant';

  // The part that can fail independently of billing, pulled out so both the initial submit
  // and a manual retry call it the same way.
  async function runProvision(subscriptionId, payload) {
    try {
      await provisionRestaurant(subscriptionId, payload);
      toast.success('Restaurant created — billing and owner login are both set up.');
      setProvisionError(null);
      setShowForm(false);
      setForm(emptyForm);
    } catch (err) {
      // Billing already exists at this point; do not close or reset -- that would strand it
      // with no way back to just this one failed step.
      setProvisionError({ subscriptionId, payload, message: err.message });
    }
    load();
  }

  async function handleCreate(e) {
    e.preventDefault();

    if (!form.productId) {
      toast.error('Product is required.');
      return;
    }
    if (form.isNewUser ? !form.newEmail || !form.newPassword : !form.userId) {
      toast.error(form.isNewUser ? 'Email and password are required.' : 'User is required.');
      return;
    }
    if (isRestaurant && !form.restaurantName.trim()) {
      toast.error('Restaurant name is required.');
      return;
    }
    if (isRestaurant && !form.restaurantPassword) {
      toast.error('A password for the restaurant owner login is required.');
      return;
    }

    setSubmitting(true);
    try {
      const userId = form.isNewUser
        ? (await createUser({ email: form.newEmail, password: form.newPassword, fullName: form.newFullName })).id
        : form.userId;

      const subscription = await createSubscription({
        userId,
        productId: form.productId,
        billingInterval: form.billingInterval,
        maxActivations: Number(form.maxActivations) || 1,
      });

      if (isRestaurant) {
        // Defaults to whichever email the billing customer above already used, so the common
        // case (one person, one login) needs nothing typed twice -- still overridable per field.
        const billingEmail = form.isNewUser ? form.newEmail : users.find((u) => u.id === userId)?.email;
        await runProvision(subscription.id, {
          email: form.restaurantEmail.trim() || billingEmail,
          password: form.restaurantPassword,
          fullName: form.newFullName || undefined,
          restaurantName: form.restaurantName.trim(),
          slug: form.restaurantSlug.trim() || undefined,
        });
      } else {
        toast.success('Subscription created.');
        setShowForm(false);
        setForm(emptyForm);
        load();
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-text-h">
          Subscriptions{' '}
          {loading ? (
            <Skeleton className="inline-block h-3 w-36 align-middle" />
          ) : (
            <span className="text-sm font-normal text-text/70">({rows.length} total, {activeCount} active)</span>
          )}
        </h2>
        <Button onClick={() => setShowForm(true)}>
          <Plus size={16} /> New subscription
        </Button>
      </div>

      <Input
        icon={Search}
        placeholder="Search by user or product…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs"
      />

      <Table>
        <Thead>
          <Tr>
            <Th>User</Th>
            <Th>Product</Th>
            <Th>Status</Th>
            <Th>Activations</Th>
            <Th>Billing</Th>
            <Th>Period end</Th>
          </Tr>
        </Thead>
        <Tbody>
          {loading && <SkeletonRows cols={6} />}
          {filtered.map((s) => (
            <Tr key={s.id} className="hover:bg-bg-alt/60">
              <Td><Link to={`/subscriptions/${s.id}`} className="text-accent hover:underline">{s.app_users?.email}</Link></Td>
              <Td>{s.products?.name}</Td>
              <Td><StatusBadge status={s.status} /></Td>
              <Td>{s.current_activations} / {s.max_activations}</Td>
              <Td>{s.billing_interval}</Td>
              <Td>{new Date(s.current_period_end).toLocaleDateString()}</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>

      <Modal
        open={showForm}
        onOpenChange={(open) => {
          setShowForm(open);
          if (!open) {
            setProvisionError(null);
            setForm(emptyForm);
          }
        }}
        title={provisionError ? 'Finish restaurant setup' : 'New subscription'}
      >
        {provisionError ? (
          <div className="space-y-3">
            <p className="rounded-md border border-warn/35 bg-warn/8 px-3 py-2 text-xs text-warn">
              The billing subscription was created. Setting up the restaurant owner&apos;s login
              failed: {provisionError.message}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setProvisionError(null);
                  setShowForm(false);
                  setForm(emptyForm);
                }}
              >
                Close — finish later
              </Button>
              <Button
                type="button"
                disabled={submitting}
                onClick={async () => {
                  setSubmitting(true);
                  await runProvision(provisionError.subscriptionId, provisionError.payload);
                  setSubmitting(false);
                }}
              >
                {submitting ? 'Retrying…' : 'Retry'}
              </Button>
            </div>
          </div>
        ) : (
        <form onSubmit={handleCreate} className="space-y-3">
          <Field
            as="div"
            label="Customer"
            hint={
              form.isNewUser
                ? 'Nothing is emailed — note the password below and send it to them yourself.'
                : undefined
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
                <Input
                  type="email"
                  placeholder="Email"
                  value={form.newEmail}
                  onChange={(e) => setForm({ ...form, newEmail: e.target.value })}
                  required
                />
                <Input
                  placeholder="Password"
                  value={form.newPassword}
                  onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
                  required
                />
                <Input
                  placeholder="Full name (optional)"
                  value={form.newFullName}
                  onChange={(e) => setForm({ ...form, newFullName: e.target.value })}
                />
              </div>
            ) : (
              <Select value={form.userId} onValueChange={(v) => setForm({ ...form, userId: v })} placeholder="Select customer…">
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.email}</SelectItem>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Product">
            <Select value={form.productId} onValueChange={(v) => setForm({ ...form, productId: v })} placeholder="Select product…">
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </Select>
          </Field>

          {isRestaurant && (
            <div className="space-y-2 rounded-md border border-border-2 p-3">
              <Field label="Restaurant name">
                <Input
                  placeholder="Sipho's Grill"
                  value={form.restaurantName}
                  onChange={(e) => setForm({ ...form, restaurantName: e.target.value })}
                  required
                />
              </Field>
              <Field label="Slug" hint="Printed on the coaster's QR forever. Defaults from the name — only override if you need a specific one.">
                <Input
                  placeholder="siphos-grill"
                  value={form.restaurantSlug}
                  onChange={(e) => setForm({ ...form, restaurantSlug: e.target.value })}
                />
              </Field>
              <Field
                as="div"
                label="Owner login"
                hint="A separate account from the one above — this is what the restaurant owner signs into their own console with."
              >
                <div className="space-y-2">
                  <Input
                    type="email"
                    placeholder={form.isNewUser ? form.newEmail || 'Email' : 'Email (defaults to the customer above)'}
                    value={form.restaurantEmail}
                    onChange={(e) => setForm({ ...form, restaurantEmail: e.target.value })}
                  />
                  <Input
                    placeholder="Password"
                    value={form.restaurantPassword}
                    onChange={(e) => setForm({ ...form, restaurantPassword: e.target.value })}
                    required
                  />
                </div>
              </Field>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Billing">
              <Select
                value={form.billingInterval}
                onValueChange={(v) => setForm({ ...form, billingInterval: v })}
              >
                <SelectItem value="monthly">monthly</SelectItem>
                <SelectItem value="yearly">yearly</SelectItem>
              </Select>
            </Field>

            {/* Was a bare number box whose only clue was a title tooltip -- invisible unless
                you happened to hover it. */}
            <Field label="Max activations" hint="Devices that may run this at once.">
              <Input
                type="number"
                min="1"
                value={form.maxActivations}
                onChange={(e) => setForm({ ...form, maxActivations: e.target.value })}
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : isRestaurant ? 'Create restaurant' : 'Create'}
            </Button>
          </div>
        </form>
        )}
      </Modal>
    </div>
  );
}
