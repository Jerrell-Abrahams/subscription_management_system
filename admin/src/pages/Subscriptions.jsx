import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Search } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { createUser, createSubscription } from '../adminApi';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { StatusBadge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
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
};

export function Subscriptions() {
  const [searchParams] = useSearchParams();
  const [subscriptions, setSubscriptions] = useState([]);
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const [{ data: subRows }, { data: userRows }, { data: productRows }] = await Promise.all([
      supabase
        .from('subscriptions')
        .select('id, status, max_activations, current_activations, current_period_end, billing_interval, app_users(email), products(name)')
        .order('created_at', { ascending: false }),
      supabase.from('app_users').select('id, email').order('email'),
      supabase.from('products').select('id, name').order('name'),
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

  const filtered = subscriptions.filter((s) => {
    const q = search.toLowerCase();
    return (
      s.app_users?.email?.toLowerCase().includes(q) ||
      s.products?.name?.toLowerCase().includes(q)
    );
  });

  const activeCount = subscriptions.filter((s) => s.status === 'active').length;

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

    setSubmitting(true);
    try {
      const userId = form.isNewUser
        ? (await createUser({ email: form.newEmail, password: form.newPassword, fullName: form.newFullName })).id
        : form.userId;

      await createSubscription({
        userId,
        productId: form.productId,
        billingInterval: form.billingInterval,
        maxActivations: Number(form.maxActivations) || 1,
      });

      toast.success('Subscription created.');
      setShowForm(false);
      setForm(emptyForm);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-text-h">
          Subscriptions <span className="text-sm font-normal text-text/70">({subscriptions.length} total, {activeCount} active)</span>
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

      <Modal open={showForm} onOpenChange={setShowForm} title="New subscription">
        <form onSubmit={handleCreate} className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={form.isNewUser}
              onChange={(e) => setForm({ ...form, isNewUser: e.target.checked })}
            />
            New user
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
            <Select value={form.userId} onValueChange={(v) => setForm({ ...form, userId: v })} placeholder="Select user…">
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.email}</SelectItem>
              ))}
            </Select>
          )}

          <Select value={form.productId} onValueChange={(v) => setForm({ ...form, productId: v })} placeholder="Select product…">
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </Select>

          <div className="flex gap-2">
            <Select
              value={form.billingInterval}
              onValueChange={(v) => setForm({ ...form, billingInterval: v })}
              className="flex-1"
            >
              <SelectItem value="monthly">monthly</SelectItem>
              <SelectItem value="yearly">yearly</SelectItem>
            </Select>
            <Input
              type="number"
              min="1"
              value={form.maxActivations}
              onChange={(e) => setForm({ ...form, maxActivations: e.target.value })}
              title="Max activations"
              className="w-28"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
