import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, KeyRound, Trash2, Pencil } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { createUser, deleteUser } from '../adminApi';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { Skeleton, SkeletonRows } from '../components/ui/Skeleton';
import { Badge } from '../components/ui/Badge';
import { Field, Input } from '../components/ui/Input';
import { ResetPasswordModal } from '../components/ResetPasswordModal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useAuth } from '../context/AuthContext';

const emptyForm = { email: '', password: '', fullName: '', phone: '', companyName: '', billingAddress: '' };

// Reused by the create and edit forms. Both feed the invoice Bill To block -- see
// billToLines in src/lib/invoices.js -- and all of it is optional.
const addressClass =
  'w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text/40 focus:border-accent focus:outline-none';

export function Users() {
  const { session } = useAuth();
  // null = not loaded yet, [] = loaded and empty -- the convention Leads already uses for
  // its activity log. It is what separates "still fetching" from "you have no users".
  const [users, setUsers] = useState(null);
  const [subscriptionCounts, setSubscriptionCounts] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [resetPasswordUser, setResetPasswordUser] = useState(null);
  const [userToDelete, setUserToDelete] = useState(null);
  const [editingUser, setEditingUser] = useState(null);

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

  // Straight to supabase rather than through the API: these are plain app_users columns
  // with no auth side effects, and the admin RLS policy already governs the write.
  async function handleEditSave(e) {
    e.preventDefault();
    const { id, ...values } = editingUser;
    const { error } = await supabase
      .from('app_users')
      .update({
        company_name: values.company_name || null,
        full_name: values.full_name || null,
        phone: values.phone || null,
        billing_address: values.billing_address || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setEditingUser(null);
    toast.success('Client details saved.');
    load();
  }

  async function handleDelete() {
    try {
      await deleteUser(userToDelete.id);
      toast.success(`${userToDelete.email} deleted.`);
      setUserToDelete(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-text-h">
          Users{' '}
          {users === null ? (
            <Skeleton className="inline-block h-3 w-8 align-middle" />
          ) : (
            <span className="text-sm font-normal text-text/70">({users.length})</span>
          )}
        </h2>
        <Button onClick={() => setShowForm(true)}>
          <Plus size={16} /> Add user
        </Button>
      </div>

      <Table>
        <Thead>
          <Tr>
            <Th>Email</Th>
            <Th>Business</Th>
            <Th>Contact</Th>
            <Th>Admin</Th>
            <Th>Subscriptions</Th>
            <Th>Joined</Th>
            <Th></Th>
          </Tr>
        </Thead>
        <Tbody>
          {users === null && <SkeletonRows cols={7} actions />}
          {users?.map((u) => (
            <Tr key={u.id} className="hover:bg-bg-alt/60">
              <Td>{u.email}</Td>
              <Td>{u.company_name || <span className="text-text/40">—</span>}</Td>
              <Td>{u.full_name || <span className="text-text/40">—</span>}</Td>
              <Td>{u.is_admin ? <Badge>admin</Badge> : null}</Td>
              <Td>
                <Link to={`/subscriptions?user=${u.id}`} className="text-accent hover:underline">
                  {subscriptionCounts[u.id] || 0}
                </Link>
              </Td>
              <Td>{new Date(u.created_at).toLocaleDateString()}</Td>
              <Td>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setEditingUser({ ...u })}>
                    <Pencil size={14} /> Details
                  </Button>
                  <Button variant="secondary" onClick={() => setResetPasswordUser(u)}>
                    <KeyRound size={14} /> Reset password
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={u.id === session?.user?.id}
                    onClick={() => setUserToDelete(u)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>

      <Modal open={showForm} onOpenChange={setShowForm} title="Add user">
        <form onSubmit={handleCreate} className="space-y-3">
          <Field label="Email" hint="Their login, and where the onboarding email goes.">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </Field>
          <Field label="Password">
            <Input
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </Field>

          <div className="space-y-3 border-t border-border pt-3">
            <p className="text-xs text-text/50">
              These four make up the Bill To block on this customer's invoices. All optional —
              blanks are skipped rather than left as gaps — and editable later under Details.
            </p>
            <Field label="Business name">
              <Input
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
              />
            </Field>
            <Field label="Contact person">
              <Input
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </Field>
            <Field label="Phone number">
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
            <Field label="Business address">
              <textarea
                rows={3}
                value={form.billingAddress}
                onChange={(e) => setForm({ ...form, billingAddress: e.target.value })}
                className={addressClass}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create'}</Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!editingUser}
        onOpenChange={(open) => !open && setEditingUser(null)}
        title={`Client details — ${editingUser?.email ?? ''}`}
      >
        <form onSubmit={handleEditSave} className="space-y-3">
          <Field label="Business name">
            <Input
              value={editingUser?.company_name ?? ''}
              onChange={(e) => setEditingUser({ ...editingUser, company_name: e.target.value })}
            />
          </Field>
          <Field label="Contact person">
            <Input
              value={editingUser?.full_name ?? ''}
              onChange={(e) => setEditingUser({ ...editingUser, full_name: e.target.value })}
            />
          </Field>
          <Field label="Phone number">
            <Input
              value={editingUser?.phone ?? ''}
              onChange={(e) => setEditingUser({ ...editingUser, phone: e.target.value })}
            />
          </Field>
          <Field label="Business address">
            <textarea
              rows={3}
              value={editingUser?.billing_address ?? ''}
              onChange={(e) => setEditingUser({ ...editingUser, billing_address: e.target.value })}
              className={addressClass}
            />
          </Field>
          <p className="text-xs text-text/50">
            The Bill To block on this customer's invoices, alongside their email. That email is
            their login account, so it isn't editable here. Invoices already generated keep the
            details they were made with.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEditingUser(null)}>Cancel</Button>
            <Button type="submit">Save details</Button>
          </div>
        </form>
      </Modal>

      <ResetPasswordModal
        open={!!resetPasswordUser}
        onOpenChange={(open) => !open && setResetPasswordUser(null)}
        user={resetPasswordUser}
      />

      <ConfirmDialog
        open={!!userToDelete}
        onOpenChange={(open) => !open && setUserToDelete(null)}
        title={`Delete ${userToDelete?.email}?`}
        description="This permanently deletes the account and cascades to their subscriptions, activations, and payment history. This can't be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}
