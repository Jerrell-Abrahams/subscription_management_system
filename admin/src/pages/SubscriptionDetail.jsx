import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, KeyRound, Ban, ShieldOff, Save, CalendarPlus } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { cancelSubscription, revokeSubscription, renewSubscription } from '../adminApi';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { Skeleton } from '../components/ui/Skeleton';
import { StatusBadge } from '../components/ui/Badge';
import { Field, Input } from '../components/ui/Input';
import { Select, SelectItem } from '../components/ui/Select';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ResetPasswordModal } from '../components/ResetPasswordModal';
import { InvoicesCard } from '../components/InvoicesCard';

function toDateInputValue(iso) {
  return iso ? iso.slice(0, 10) : '';
}

// past_due deliberately excluded: nothing in the platform sets or reads it
// yet (reserved for a future payment provider), so offering it here would
// only create meaningless states. Existing past_due rows still render via
// the disabled-option fallback below.
const EDITABLE_STATUSES = ['pending', 'active'];

// Add-on modules each product can sell. Mirrors PRODUCT_MODULES in src/lib/modules.js — kept as a
// fixed list rather than free text because the consuming app matches these slugs exactly and
// silently ignores anything else, so a typo would look like "the module just doesn't turn on".
const PRODUCT_MODULES = {
  'pos-system': [{ slug: 'wholesale', label: 'Wholesaler' }],
};

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
      // products(slug) drives which add-on modules this product can sell (see PRODUCT_MODULES).
      supabase.from('subscriptions').select('*, app_users(email), products(name, slug)').eq('id', id).single(),
      supabase.from('activations').select('*').eq('subscription_id', id).order('activated_at', { ascending: false }),
    ]);
    setSubscription(subRow);
    setActivations(activationRows || []);
    setForm({
      status: subRow?.status ?? 'pending',
      max_activations: subRow?.max_activations ?? 1,
      billing_interval: subRow?.billing_interval ?? 'monthly',
      current_period_end: toDateInputValue(subRow?.current_period_end),
      super_user_code: subRow?.super_user_code ?? '',
      modules: subRow?.modules ?? [],
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSave(e) {
    e.preventDefault();
    // Typed on the POS's 4-6 digit keypad; reject anything it can't enter so an admin
    // can't set a code that silently never works on the till (superUserCode.js hashes it as-is).
    const code = form.super_user_code.trim();
    if (code && !/^\d{4,6}$/.test(code)) {
      toast.error('Super user code must be 4–6 digits (or blank to disable).');
      return;
    }
    const { error } = await supabase
      .from('subscriptions')
      .update({
        status: form.status,
        max_activations: Number(form.max_activations) || 1,
        billing_interval: form.billing_interval,
        current_period_end: form.current_period_end ? new Date(form.current_period_end).toISOString() : null,
        super_user_code: code || null,
        modules: form.modules,
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

  // Still a whole-page gate -- every block below reads `subscription` -- but a shaped one,
  // so the page settles into its layout instead of replacing a line of text with a screen.
  if (!subscription || !form)
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-40" />
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-3.5 w-32" />
          </div>
          <div className="flex gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-28" />
            ))}
          </div>
        </div>
        <Card className="space-y-4">
          <Skeleton className="h-3.5 w-28" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[34px]" />
            ))}
          </div>
        </Card>
        <Card>
          <Skeleton className="h-3.5 w-28" />
        </Card>
      </div>
    );

  const canCancel = !['canceled', 'expired', 'revoked'].includes(subscription.status);
  const canRevoke = subscription.status !== 'revoked';
  const canRenew = subscription.status !== 'revoked';
  const availableModules = PRODUCT_MODULES[subscription.products?.slug] ?? [];
  const savedModules = subscription.modules ?? [];
  // Order-insensitive: the checkbox order and Postgres's stored order need not agree, and a
  // difference in order alone must not light up the Save button.
  const modulesChanged =
    form.modules.length !== savedModules.length || form.modules.some((m) => !savedModules.includes(m));

  const isDirty =
    form.status !== subscription.status ||
    Number(form.max_activations) !== subscription.max_activations ||
    form.billing_interval !== subscription.billing_interval ||
    form.current_period_end !== toDateInputValue(subscription.current_period_end) ||
    form.super_user_code.trim() !== (subscription.super_user_code ?? '') ||
    modulesChanged;

  function toggleModule(slug) {
    setForm((f) => ({
      ...f,
      modules: f.modules.includes(slug) ? f.modules.filter((m) => m !== slug) : [...f.modules, slug],
    }));
  }

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
            <Field label="Status">
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                {!EDITABLE_STATUSES.includes(subscription.status) && (
                  <SelectItem value={subscription.status} disabled>{subscription.status}</SelectItem>
                )}
                {EDITABLE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </Select>
            </Field>
            <Field label="Billing interval">
              <Select value={form.billing_interval} onValueChange={(v) => setForm({ ...form, billing_interval: v })}>
                <SelectItem value="monthly">monthly</SelectItem>
                <SelectItem value="yearly">yearly</SelectItem>
              </Select>
            </Field>
            <Field label="Max activations">
              <Input
                type="number"
                min="1"
                value={form.max_activations}
                onChange={(e) => setForm({ ...form, max_activations: e.target.value })}
              />
            </Field>
            <Field label="Current period end">
              <Input
                type="date"
                value={form.current_period_end}
                onChange={(e) => setForm({ ...form, current_period_end: e.target.value })}
              />
            </Field>
          </div>
          <Field
            className="mt-4"
            label="Super user support code"
            hint="Signs support into this customer's POS with manager rights. Use a unique code per subscription. The till applies a change after its next online status check (≤6h) — it won't reach a currently-offline till until it reconnects."
          >
            <Input
              inputMode="numeric"
              placeholder="4–6 digits, blank to disable"
              value={form.super_user_code}
              onChange={(e) => setForm({ ...form, super_user_code: e.target.value })}
              className="sm:max-w-xs"
            />
          </Field>
          {availableModules.length > 0 && (
            <Field
              as="div"
              className="mt-4"
              label="Add-on modules"
              hint="Unlocks paid parts of the product. A customer without a module sees no trace of it. Like the support code, the app applies a change after its next online status check (≤6h) — turning one off does not reach a currently-offline device until it reconnects."
            >
              <div className="flex flex-wrap gap-2">
                {availableModules.map((module) => {
                  const enabled = form.modules.includes(module.slug);
                  return (
                    <button
                      key={module.slug}
                      type="button"
                      onClick={() => toggleModule(module.slug)}
                      className={`rounded-md border px-3 py-1.5 text-sm transition ${
                        enabled
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border text-text/60 hover:text-text'
                      }`}
                    >
                      {module.label}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}
          <div className="mt-5 flex items-center justify-end border-t border-border pt-4">
            <Button type="submit" disabled={!isDirty}>
              <Save size={15} /> Save changes
            </Button>
          </div>
        </form>
      </Card>

      <InvoicesCard subscriptionId={id} />

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
