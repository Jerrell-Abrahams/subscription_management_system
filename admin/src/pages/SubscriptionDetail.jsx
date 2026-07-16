import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, KeyRound, Ban, ShieldOff, Save, CalendarPlus } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { cancelSubscription, revokeSubscription, renewSubscription } from '../adminApi';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { StatusBadge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Select, SelectItem } from '../components/ui/Select';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ResetPasswordModal } from '../components/ResetPasswordModal';

function toDateInputValue(iso) {
  return iso ? iso.slice(0, 10) : '';
}

// past_due deliberately excluded: nothing in the platform sets or reads it
// yet (reserved for a future payment provider), so offering it here would
// only create meaningless states. Existing past_due rows still render via
// the disabled-option fallback below.
const EDITABLE_STATUSES = ['pending', 'active'];

export function SubscriptionDetail() {
  const { id } = useParams();
  const [subscription, setSubscription] = useState(null);
  const [activations, setActivations] = useState([]);
  const [form, setForm] = useState(null);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [activationToRevoke, setActivationToRevoke] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmRenew, setConfirmRenew] = useState(false);

  async function load() {
    const [{ data: subRow }, { data: activationRows }] = await Promise.all([
      supabase.from('subscriptions').select('*, app_users(email), products(name)').eq('id', id).single(),
      supabase.from('activations').select('*').eq('subscription_id', id).order('activated_at', { ascending: false }),
    ]);
    setSubscription(subRow);
    setActivations(activationRows || []);
    setForm({
      status: subRow?.status ?? 'pending',
      max_activations: subRow?.max_activations ?? 1,
      billing_interval: subRow?.billing_interval ?? 'monthly',
      current_period_end: toDateInputValue(subRow?.current_period_end),
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSave(e) {
    e.preventDefault();
    const { error } = await supabase
      .from('subscriptions')
      .update({
        status: form.status,
        max_activations: Number(form.max_activations) || 1,
        billing_interval: form.billing_interval,
        current_period_end: form.current_period_end ? new Date(form.current_period_end).toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Subscription updated.');
    load();
  }

  async function handleRevokeActivation() {
    const { error: deleteError } = await supabase.from('activations').delete().eq('id', activationToRevoke.id);
    const device = activationToRevoke.device_name || activationToRevoke.device_fingerprint;
    setActivationToRevoke(null);
    if (deleteError) {
      toast.error(deleteError.message);
      return;
    }
    await supabase
      .from('subscriptions')
      .update({ current_activations: Math.max(0, subscription.current_activations - 1) })
      .eq('id', id);
    toast.success(`Device "${device}" revoked.`);
    load();
  }

  async function handleCancel() {
    try {
      await cancelSubscription(id);
      toast.success('Subscription canceled.');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleRevoke() {
    try {
      await revokeSubscription(id);
      toast.success('Subscription revoked.');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleRenew() {
    try {
      const updated = await renewSubscription(id);
      toast.success(`Renewed until ${new Date(updated.current_period_end).toLocaleDateString()}.`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (!subscription || !form) return <p className="p-8 text-sm text-text/70">Loading…</p>;

  const canCancel = !['canceled', 'expired', 'revoked'].includes(subscription.status);
  const canRevoke = subscription.status !== 'revoked';
  const canRenew = subscription.status !== 'revoked';
  const isDirty =
    form.status !== subscription.status ||
    Number(form.max_activations) !== subscription.max_activations ||
    form.billing_interval !== subscription.billing_interval ||
    form.current_period_end !== toDateInputValue(subscription.current_period_end);

  return (
    <div className="space-y-6">
      <Link to="/subscriptions" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
        <ArrowLeft size={14} /> Back to subscriptions
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-text-h">
            {subscription.app_users?.email}
            <StatusBadge status={subscription.status} />
          </h2>
          <p className="text-sm text-text/70">{subscription.products?.name}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setResetPasswordOpen(true)}>
            <KeyRound size={15} /> Reset password
          </Button>
          <Button variant="secondary" disabled={!canRenew} onClick={() => setConfirmRenew(true)}>
            <CalendarPlus size={15} /> Renew
          </Button>
          <Button variant="secondary" disabled={!canCancel} onClick={() => setConfirmCancel(true)}>
            <Ban size={15} /> Cancel
          </Button>
          <Button variant="destructive" disabled={!canRevoke} onClick={() => setConfirmRevoke(true)}>
            <ShieldOff size={15} /> Revoke
          </Button>
        </div>
      </div>

      <Card>
        <h3 className="mb-4 text-sm font-semibold text-text-h">Subscription</h3>
        <form onSubmit={handleSave}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <label className="flex flex-col gap-1.5 text-xs font-medium text-text/70">
              Status
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                {!EDITABLE_STATUSES.includes(subscription.status) && (
                  <SelectItem value={subscription.status} disabled>{subscription.status}</SelectItem>
                )}
                {EDITABLE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-text/70">
              Billing interval
              <Select value={form.billing_interval} onValueChange={(v) => setForm({ ...form, billing_interval: v })}>
                <SelectItem value="monthly">monthly</SelectItem>
                <SelectItem value="yearly">yearly</SelectItem>
              </Select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-text/70">
              Max activations
              <Input
                type="number"
                min="1"
                value={form.max_activations}
                onChange={(e) => setForm({ ...form, max_activations: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-text/70">
              Current period end
              <Input
                type="date"
                value={form.current_period_end}
                onChange={(e) => setForm({ ...form, current_period_end: e.target.value })}
              />
            </label>
          </div>
          <div className="mt-5 flex items-center justify-end border-t border-border pt-4">
            <Button type="submit" disabled={!isDirty}>
              <Save size={15} /> Save changes
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-text-h">
          Activations ({activations.length} / {subscription.max_activations})
        </h3>
        <Table>
          <Thead>
            <Tr><Th>Device</Th><Th>Fingerprint</Th><Th>Activated</Th><Th></Th></Tr>
          </Thead>
          <Tbody>
            {activations.map((a) => (
              <Tr key={a.id}>
                <Td>{a.device_name || '—'}</Td>
                <Td className="font-mono text-xs">{a.device_fingerprint}</Td>
                <Td>{new Date(a.activated_at).toLocaleString()}</Td>
                <Td>
                  <Button variant="secondary" onClick={() => setActivationToRevoke(a)}>Revoke</Button>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>

      <ResetPasswordModal
        open={resetPasswordOpen}
        onOpenChange={setResetPasswordOpen}
        user={subscription.app_users ? { id: subscription.user_id, email: subscription.app_users.email } : null}
      />

      <ConfirmDialog
        open={!!activationToRevoke}
        onOpenChange={(open) => !open && setActivationToRevoke(null)}
        title="Revoke device"
        description={`Revoke device "${activationToRevoke?.device_name || activationToRevoke?.device_fingerprint}"?`}
        confirmLabel="Revoke"
        destructive
        onConfirm={handleRevokeActivation}
      />

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel subscription"
        description="This sets the subscription's status to canceled. The customer will lose access."
        confirmLabel="Cancel subscription"
        destructive
        onConfirm={handleCancel}
      />

      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title="Revoke subscription"
        description="This immediately and permanently revokes access. Use for abuse/fraud, not routine cancellation."
        confirmLabel="Revoke subscription"
        destructive
        onConfirm={handleRevoke}
      />

      <ConfirmDialog
        open={confirmRenew}
        onOpenChange={setConfirmRenew}
        title="Renew subscription"
        description={`Extends the subscription by ${subscription.billing_interval === 'yearly' ? '12 months' : '1 month'} from its current period end (or from today if lapsed) and sets it active.`}
        confirmLabel="Renew"
        onConfirm={handleRenew}
      />
    </div>
  );
}
