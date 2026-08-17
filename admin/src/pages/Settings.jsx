import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Save, Sun, Moon } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useTheme } from '../lib/theme';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field, Input } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';

// Every field is optional and simply doesn't render on the PDF when blank, so there is
// no validation here beyond what the inputs already do.
const FIELDS = {
  business: [
    ['business_name', 'Business name', 'Appears as the heading on every invoice'],
    ['legal_name', 'Legal name', 'e.g. Jerrell Abrahams / Sole Proprietor'],
    ['phone', 'Phone number', ''],
    ['email', 'Email address', ''],
    ['tax_number', 'Tax number', 'Optional — leave blank if you have none'],
  ],
  // Same order they print on the invoice, so this form reads like the document does.
  bank: [
    ['bank_name', 'Bank', 'e.g. Capitec'],
    ['bank_account_name', 'Account name', ''],
    ['bank_account_number', 'Account number', ''],
    ['bank_account_type', 'Account type', 'e.g. Current or Cheque'],
    ['bank_branch_code', 'Branch code', ''],
  ],
};

export function Settings() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [theme, toggleTheme] = useTheme();

  async function load() {
    // Seeded by src/db/settings.sql, so this row always exists and saving is an update.
    const { data, error } = await supabase.from('app_settings').select('*').maybeSingle();
    if (error) {
      toast.error(error.message);
      return;
    }
    setForm(data || {});
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    const { id, updated_at, ...values } = form;
    const { error } = await supabase
      .from('app_settings')
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq('id', true);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Business details saved.');
  }

  // Sits outside the form: the theme is per-device and applies the moment you click it,
  // so it must not read as something "Save settings" is holding.
  const appearance = (
    <Card className="flex max-w-3xl items-center justify-between gap-4">
      <div>
        <h3 className="text-sm font-semibold text-text-h">Appearance</h3>
        <p className="text-xs text-text/50">
          Currently {theme}. Remembered on this device only — it isn't part of your account.
        </p>
      </div>
      <Button type="button" variant="secondary" onClick={toggleTheme}>
        {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        Switch to {theme === 'dark' ? 'light' : 'dark'}
      </Button>
    </Card>
  );

  const field = ([key, label, hint]) => (
    <Field key={key} label={label} hint={hint}>
      <Input value={form[key] ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </Field>
  );

  // The theme card renders even while the settings row is loading (or failed to) -- it is
  // the only place to change the theme now, so it must not depend on Supabase answering.
  if (!form)
    return (
      <>
        <div className="max-w-3xl space-y-4">
          <Skeleton className="h-6 w-28" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
        {appearance}
      </>
    );

  return (
    <>
    <form onSubmit={handleSave} className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-text-h">Settings</h2>
        <p className="text-sm text-text/70">
          These details print on every invoice and receipt. Changes apply to documents generated
          from now on — PDFs already sent keep the details they were made with.
        </p>
      </div>

      <Card>
        <h3 className="mb-4 text-sm font-semibold text-text-h">Your business</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{FIELDS.business.map(field)}</div>
        <Field
          className="mt-4"
          label="Business address"
          hint="One line per line. A postal or trading address is fine — it doesn't have to be residential."
        >
          <textarea
            rows={3}
            value={form.address ?? ''}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text/40 focus:border-accent focus:outline-none"
          />
        </Field>
        <p className="mt-4 text-xs text-text/50">
          A tax number here is printed for reference only. It does not add VAT to anything — as an
          unregistered vendor you may not charge it, so invoices stay headed "Invoice" and show no
          tax line.
        </p>
      </Card>

      <Card>
        <h3 className="mb-1 text-sm font-semibold text-text-h">Banking details</h3>
        <p className="mb-4 text-xs text-text/50">
          Printed on invoices so customers know where to pay. Receipts leave this out — the money
          already arrived.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{FIELDS.bank.map(field)}</div>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          <Save size={15} /> {saving ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </form>

    {appearance}
    </>
  );
}
