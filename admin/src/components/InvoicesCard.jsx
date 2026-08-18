import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Send, Check, Ban, Download, Pencil } from 'lucide-react';
import { supabase } from '../supabaseClient';
import {
  createInvoice,
  updateInvoice,
  sendInvoice,
  payInvoice,
  voidInvoice,
  getInvoicePdfUrl,
} from '../adminApi';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Table, Thead, Tbody, Tr, Th, Td } from './ui/Table';
import { Skeleton, SkeletonRows } from './ui/Skeleton';
import { StatusBadge } from './ui/Badge';
import { Field, Input } from './ui/Input';
import { Select, SelectItem } from './ui/Select';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { money, day, today } from '../lib/format';
import { matchesFilter, isOverdue } from '../lib/invoices';

// The invoice keeps its identity once numbered; a paid one just gains a second document.
const docNumber = (i) => (i.number == null ? 'Draft' : `INV-${String(i.number).padStart(4, '0')}`);

// With a subscriptionId this is the card on the subscription page. Without one it is the
// whole book, and grows a customer column, a status filter and no "New invoice" button --
// a draft has to belong to a subscription, so it starts from that subscription's page.
export function InvoicesCard({ subscriptionId }) {
  // null = not loaded, [] = loaded and empty. This card used to explain how automatic
  // invoicing works while the query was still running, which reads as "there are none".
  const [invoices, setInvoices] = useState(null);
  const [filter, setFilter] = useState('outstanding');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [paying, setPaying] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [sending, setSending] = useState(null);

  async function load() {
    // The join is only asked for in book mode; on a subscription page the customer is the
    // heading two cards up.
    const query = supabase
      .from('invoices')
      .select(subscriptionId ? '*' : '*, subscriptions(app_users(email), products(name))')
      .order('created_at', { ascending: false });
    const { data } = await (subscriptionId ? query.eq('subscription_id', subscriptionId) : query);
    setInvoices(data || []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriptionId]);

  // Filtering in memory, not in the query: the whole book is a few hundred rows at most
  // and this way switching filters is instant and costs no round trip.
  // ponytail: move the filter into the query if this ever passes a few thousand invoices.
  const shown = invoices && !subscriptionId ? invoices.filter((i) => matchesFilter(i, filter)) : invoices;

  // Every action shares this: run it, surface the error, reload. Individually they'd be
  // six copies of the same try/catch.
  async function act(fn, success) {
    setBusy(true);
    try {
      const result = await fn();
      toast.success(success);
      await load();
      return result;
    } catch (err) {
      toast.error(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function openPdf(invoice, doc) {
    try {
      const { downloadUrl } = await getInvoicePdfUrl(invoice.id, doc);
      window.open(downloadUrl, '_blank', 'noopener');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleSend() {
    const invoice = sending;
    setSending(null);
    const result = await act(() => sendInvoice(invoice.id), 'Invoice generated.');
    if (result?.downloadUrl) window.open(result.downloadUrl, '_blank', 'noopener');
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {subscriptionId ? (
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text-h">
            Invoices
            {invoices === null ? <Skeleton className="h-3 w-6" /> : `(${invoices.length})`}
          </h3>
        ) : (
          <Select value={filter} onValueChange={setFilter} className="w-44">
            <SelectItem value="outstanding">Outstanding</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="void">Void</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </Select>
        )}
        {subscriptionId ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => act(() => createInvoice({ subscriptionId }), 'Draft invoice created.')}
          >
            <Plus size={15} /> New invoice
          </Button>
        ) : (
          <span className="text-[12.5px] text-dim">
            {shown === null ? '' : `${shown.length} invoice${shown.length === 1 ? '' : 's'}`}
          </span>
        )}
      </div>

      {shown?.length === 0 ? (
        <p className="text-sm text-text/60">
          {subscriptionId
            ? "No invoices yet. One is drafted automatically 7 days before this subscription's period ends, or create one now."
            : 'Nothing here. Drafts start from a subscription — open one and use New invoice.'}
        </p>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Number</Th>
              {!subscriptionId && <Th>Customer</Th>}
              <Th>Period</Th><Th>Amount</Th><Th>Due</Th><Th>Status</Th><Th></Th>
            </Tr>
          </Thead>
          <Tbody>
            {shown === null && <SkeletonRows cols={subscriptionId ? 6 : 7} rows={3} actions />}
            {shown?.map((i) => {
              const overdue = isOverdue(i, today());
              return (
                <Tr key={i.id}>
                  <Td className="font-mono text-xs">{docNumber(i)}</Td>
                  {!subscriptionId && (
                    <Td>
                      <Link to={`/subscriptions/${i.subscription_id}`} className="text-accent hover:underline">
                        {i.subscriptions?.app_users?.email || '—'}
                      </Link>
                      <span className="block text-xs text-dim">{i.subscriptions?.products?.name}</span>
                    </Td>
                  )}
                  <Td className="text-xs">{day(i.period_start)} – {day(i.period_end)}</Td>
                  <Td>{money(i.amount)}</Td>
                  <Td className={overdue ? 'font-medium text-red-600 dark:text-red-400' : undefined}>
                    {day(i.due_date)}{overdue ? ' · overdue' : ''}
                  </Td>
                  <Td>
                    <StatusBadge status={i.status} />
                    {i.status === 'void' && i.void_reason ? (
                      <span className="ml-2 text-xs text-text/50">{i.void_reason}</span>
                    ) : null}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      {i.status === 'draft' && (
                        <>
                          <Button variant="secondary" onClick={() => setEditing({ ...i, amount: i.amount ?? '', description: i.description ?? '' })}>
                            <Pencil size={14} /> Edit
                          </Button>
                          <Button disabled={busy} onClick={() => setSending(i)}>
                            <Send size={14} /> Generate
                          </Button>
                        </>
                      )}
                      {i.status === 'sent' && (
                        <>
                          <Button variant="secondary" onClick={() => openPdf(i)}>
                            <Download size={14} /> Invoice
                          </Button>
                          <Button disabled={busy} onClick={() => setPaying({ ...i, paidAt: today(), paymentReference: '' })}>
                            <Check size={14} /> Mark paid
                          </Button>
                        </>
                      )}
                      {i.status === 'paid' && (
                        <>
                          <Button variant="secondary" onClick={() => openPdf(i)}>
                            <Download size={14} /> Invoice
                          </Button>
                          <Button variant="secondary" onClick={() => openPdf(i, 'receipt')}>
                            <Download size={14} /> Receipt
                          </Button>
                        </>
                      )}
                      {(i.status === 'draft' || i.status === 'sent') && (
                        <Button variant="destructive" disabled={busy} onClick={() => setVoiding({ ...i, reason: '' })}>
                          <Ban size={14} /> Void
                        </Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      )}

      <Modal open={!!editing} onOpenChange={(open) => !open && setEditing(null)} title={`Edit ${editing ? docNumber(editing) : ''}`}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const draft = editing;
            setEditing(null);
            await act(
              () => updateInvoice(draft.id, { amount: draft.amount, description: draft.description }),
              'Draft updated.'
            );
          }}
        >
          <Field
            label="Amount (ZAR)"
            hint="Pre-filled from this subscription's last invoice. There's no stored price — what you charge here becomes the default next time."
          >
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="750.00"
              value={editing?.amount ?? ''}
              onChange={(e) => setEditing({ ...editing, amount: e.target.value })}
            />
          </Field>
          <Field label="Description (optional)">
            <Input
              placeholder="Leave blank for the product name and billing period"
              value={editing?.description ?? ''}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit">Save draft</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!paying} onOpenChange={(open) => !open && setPaying(null)} title={`Mark ${paying ? docNumber(paying) : ''} paid`}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const invoice = paying;
            setPaying(null);
            const result = await act(
              () => payInvoice(invoice.id, { paidAt: invoice.paidAt, paymentReference: invoice.paymentReference }),
              'Marked paid — receipt generated.'
            );
            if (result?.downloadUrl) window.open(result.downloadUrl, '_blank', 'noopener');
          }}
        >
          <Field label="Date paid">
            <Input type="date" value={paying?.paidAt ?? ''} onChange={(e) => setPaying({ ...paying, paidAt: e.target.value })} />
          </Field>
          <Field label="Bank reference (optional)">
            <Input
              placeholder="As it appears on your statement"
              value={paying?.paymentReference ?? ''}
              onChange={(e) => setPaying({ ...paying, paymentReference: e.target.value })}
            />
          </Field>
          <p className="text-xs text-text/50">Generates the receipt PDF. This can't be undone from here.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setPaying(null)}>Cancel</Button>
            <Button type="submit">Mark paid</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!voiding} onOpenChange={(open) => !open && setVoiding(null)} title={`Void ${voiding ? docNumber(voiding) : ''}`}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const invoice = voiding;
            setVoiding(null);
            await act(() => voidInvoice(invoice.id, invoice.reason), 'Invoice voided.');
          }}
        >
          <p className="text-sm text-text/70">
            A sent invoice can't be edited — the customer already has the PDF. Voiding it frees this
            billing period up so you can issue a corrected one.
          </p>
          <Field label="Reason">
            <Input
              required
              placeholder="e.g. wrong amount"
              value={voiding?.reason ?? ''}
              onChange={(e) => setVoiding({ ...voiding, reason: e.target.value })}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setVoiding(null)}>Cancel</Button>
            <Button type="submit" variant="destructive">Void invoice</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!sending}
        onOpenChange={(open) => !open && setSending(null)}
        title={`Generate ${sending ? money(sending.amount) : ''} invoice`}
        description="Assigns the next invoice number and creates the PDF. After this the invoice can't be edited — only voided and reissued. Nothing is emailed; download it and send it yourself."
        confirmLabel="Generate"
        onConfirm={handleSend}
      />
    </Card>
  );
}
