import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, KeyRound } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { createUser } from '../adminApi';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { ResetPasswordModal } from '../components/ResetPasswordModal';

const emptyForm = { email: '', password: '', fullName: '' };

export function Users() {
  const [users, setUsers] = useState([]);
  const [subscriptionCounts, setSubscriptionCounts] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [resetPasswordUser, setResetPasswordUser] = useState(null);

  async function load() {
    const { data: userRows } = await supabase.from('app_users').select('*').order('created_at', { ascending: false });
    setUsers(userRows || []);

    const { data: subRows } = await supabase.from('subscriptions').select('user_id');
    const counts = {};
    (subRows || []).forEach((s) => {
      counts[s.user_id] = (counts[s.user_id] || 0) + 1;
    });
    setSubscriptionCounts(counts);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.email || !form.password) {
      toast.error('Email and password are required.');
      return;
    }
    setSubmitting(true);
    try {
      await createUser(form);
      toast.success('User created.');
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
          Users <span className="text-sm font-normal text-text/70">({users.length})</span>
        </h2>
        <Button onClick={() => setShowForm(true)}>
          <Plus size={16} /> Add user
        </Button>
      </div>

      <Table>
        <Thead>
          <Tr>
            <Th>Email</Th>
            <Th>Full name</Th>
            <Th>Admin</Th>
            <Th>Subscriptions</Th>
            <Th>Joined</Th>
            <Th></Th>
          </Tr>
        </Thead>
        <Tbody>
          {users.map((u) => (
            <Tr key={u.id} className="hover:bg-bg-alt/60">
              <Td>{u.email}</Td>
              <Td>{u.full_name || '—'}</Td>
              <Td>{u.is_admin ? <Badge>admin</Badge> : null}</Td>
              <Td>
                <Link to={`/subscriptions?user=${u.id}`} className="text-accent hover:underline">
                  {subscriptionCounts[u.id] || 0}
                </Link>
              </Td>
              <Td>{new Date(u.created_at).toLocaleDateString()}</Td>
              <Td>
                <Button variant="secondary" onClick={() => setResetPasswordUser(u)}>
                  <KeyRound size={14} /> Reset password
                </Button>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>

      <Modal open={showForm} onOpenChange={setShowForm} title="Add user">
        <form onSubmit={handleCreate} className="space-y-3">
          <Input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <Input
            placeholder="Password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <Input
            placeholder="Full name (optional)"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create'}</Button>
          </div>
        </form>
      </Modal>

      <ResetPasswordModal
        open={!!resetPasswordUser}
        onOpenChange={(open) => !open && setResetPasswordUser(null)}
        user={resetPasswordUser}
      />
    </div>
  );
}
