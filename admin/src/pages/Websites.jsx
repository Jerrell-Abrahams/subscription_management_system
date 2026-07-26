import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Search } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { createUser, createWebsite, suspendSubscription, renewSubscription } from '../adminApi';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { StatusBadge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
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

export function Websites() {
  const [websites, setWebsites] = useState([]);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);

  async function load() {
    const [{ data: siteRows }, { data: userRows }] = await Promise.all([
      supabase
        .from('websites')
        .select('id, domain, created_at, subscriptions(id, status, current_period_end, billing_interval, app_users(email))')
        .order('created_at', { ascending: false }),
      supabase.from('app_users').select('id, email').order('email'),
    ]);
    setWebsites(siteRows || []);
    setUsers(userRows || []);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = websites.filter((w) => {
    const q = search.toLowerCase();
    return w.domain?.toLowerCase().includes(q) || w.subscriptions?.app_users?.email?.toLowerCase().includes(q);
  });

  const liveCount = websites.filter((w) => w.subscriptions?.status === 'active').length;

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-text-h">
          Websites <span className="text-sm font-normal text-text/70">({websites.length} total, {liveCount} live)</span>
        </h2>
        <Button onClick={() => setShowForm(true)}>
          <Plus size={16} /> Add website
        </Button>
      </div>

      <Input
        icon={Search}
        placeholder="Search by domain or owner…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs"
      />

      <Table>
        <Thead>
          <Tr>
            <Th>Domain</Th>
            <Th>Owner</Th>
            <Th>Status</Th>
            <Th>Billing</Th>
            <Th>Period end</Th>
            <Th>Actions</Th>
          </Tr>
        </Thead>
        <Tbody>
          {filtered.map((w) => {
            const sub = w.subscriptions;
            const isLive = sub?.status === 'active';
            return (
              <Tr key={w.id} className="hover:bg-bg-alt/60">
                <Td>
                  {sub ? (
                    <Link to={`/subscriptions/${sub.id}`} className="text-accent hover:underline">{w.domain}</Link>
                  ) : (
                    w.domain
                  )}
                </Td>
                <Td>{sub?.app_users?.email}</Td>
                <Td>{sub ? <StatusBadge status={sub.status} /> : '—'}</Td>
                <Td>{sub?.billing_interval}</Td>
                <Td>{sub ? new Date(sub.current_period_end).toLocaleDateString() : '—'}</Td>
                <Td>
                  <Button
                    variant={isLive ? 'destructive' : 'secondary'}
                    className="px-2.5 py-1 text-xs"
                    disabled={busyId === w.id || !sub}
                    onClick={() => handleToggle(w)}
                  >
                    {isLive ? 'Suspend' : 'Reactivate'}
                  </Button>
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>

      <Modal open={showForm} onOpenChange={setShowForm} title="Add website">
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
              <Input type="email" placeholder="Email" value={form.newEmail} onChange={(e) => setForm({ ...form, newEmail: e.target.value })} required />
              <Input placeholder="Password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} required />
              <Input placeholder="Full name (optional)" value={form.newFullName} onChange={(e) => setForm({ ...form, newFullName: e.target.value })} />
            </div>
          ) : (
            <Select value={form.userId} onValueChange={(v) => setForm({ ...form, userId: v })} placeholder="Select user…">
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.email}</SelectItem>
              ))}
            </Select>
          )}

          <Input
            placeholder="example.com"
            value={form.domain}
            onChange={(e) => setForm({ ...form, domain: e.target.value })}
            required
          />

          <Select value={form.billingInterval} onValueChange={(v) => setForm({ ...form, billingInterval: v })}>
            <SelectItem value="monthly">monthly</SelectItem>
            <SelectItem value="yearly">yearly</SelectItem>
          </Select>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? 'Adding…' : 'Add website'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
