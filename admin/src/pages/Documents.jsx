import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FileText, Download, CircleHelp } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { listDocumentTemplates, generateDocument } from '../adminApi';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field, Input } from '../components/ui/Input';
import { Select, SelectItem } from '../components/ui/Select';
import { Skeleton } from '../components/ui/Skeleton';

// Client documents: pick a template, fill it in, download the PDF.
//
// The form is not written out field by field -- the API returns the field list it derived
// from the template text, and this page maps over it. A clause added to a .md file with a
// new {{VAR}} grows an input here on its own, which is the only reason five documents with
// ~120 fields between them is a page this size.

// What app_users can answer for us. A contract also needs a legal name and a registration
// number, which are not columns on that table and are typed per document.
const FROM_CLIENT = {
  CLIENT_NAME: (u) => u.company_name || u.full_name,
  CLIENT_LEGAL_NAME: (u) => u.company_name,
  CLIENT_EMAIL: (u) => u.email,
  CLIENT_PHONE: (u) => u.phone,
  CLIENT_ADDRESS: (u) => u.billing_address,
  CLIENT_REPRESENTATIVE: (u) => u.full_name,
};

const storageKey = (slug) => `documents:${slug}`;

const textarea =
  'w-full rounded-md border border-border-2 bg-panel px-[11px] py-2 text-[13.5px] text-text ' +
  'placeholder:text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

// Hover tooltip on desktop, plain visible text on a phone. Every one of the ~30 fields on
// a document has a hint, and inline that reads as more explanation than form -- but `title`
// never fires without a pointer, so a tooltip-only version leaves the mobile console with
// no help at all, on the screen where the guidance is load-bearing ("this is what makes
// their signature binding"). Two Tailwind breakpoints, no popover library.
//
// The marker is aria-hidden and not focusable: it is decoration over text that is already
// in the DOM. `aria-label` on a bare <span> is not reliably announced anyway, and this one
// sits inside Field's <label> (Input.jsx:31), where a click would just forward to the input.
function Help({ text }) {
  return (
    <span
      aria-hidden="true"
      title={text}
      className="hidden cursor-help text-text/35 transition-colors hover:text-text/70 sm:inline-flex"
    >
      <CircleHelp size={12.5} />
    </span>
  );
}

// The one multi-line default is the maintenance list. Five bullet lines pasted into a
// tooltip is unreadable, and its hint says in words what the default is anyway.
const singleLineDefault = (field) => field.default && !field.default.includes('\n');

export function Documents() {
  const [templates, setTemplates] = useState(null);
  const [clients, setClients] = useState([]);
  const [slug, setSlug] = useState('');
  const [values, setValues] = useState({});
  const [reviewNotes, setReviewNotes] = useState(true);
  const [busy, setBusy] = useState(false);
  // Controlled, so that re-picking the same customer after switching template still fires.
  const [clientId, setClientId] = useState('');

  const template = useMemo(() => (templates || []).find((t) => t.slug === slug), [templates, slug]);

  useEffect(() => {
    listDocumentTemplates()
      .then(({ templates: list }) => {
        setTemplates(list);
        setSlug((current) => current || list[0]?.slug || '');
      })
      .catch((err) => toast.error(err.message));

    // Straight to supabase, like Customers does -- these are plain app_users columns.
    supabase
      .from('app_users')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => setClients(data || []));
  }, []);

  // Each template remembers what you last typed into it. Nothing is stored server-side, so
  // without this a second document for the same client means retyping everything.
  //
  // Parsed defensively: an interrupted write leaves a truncated value, and an uncaught
  // throw in this effect unmounts the route with no error boundary above it -- a blank
  // page you can only fix from devtools, on every visit.
  useEffect(() => {
    if (!slug) return;
    setClientId('');
    try {
      const saved = localStorage.getItem(storageKey(slug));
      setValues(saved ? JSON.parse(saved) : {});
    } catch {
      localStorage.removeItem(storageKey(slug));
      setValues({});
    }
  }, [slug]);

  function update(next) {
    setValues(next);
    if (slug) localStorage.setItem(storageKey(slug), JSON.stringify(next));
  }

  function applyClient(userId) {
    setClientId(userId);
    const user = clients.find((c) => c.id === userId);
    if (!user) return;
    const filled = { ...values };
    for (const [name, read] of Object.entries(FROM_CLIENT)) {
      const value = read(user);
      if (value) filled[name] = value;
    }
    update(filled);
    toast.success('Client details filled in. Legal name and registration number still need checking.');
  }

  async function handleGenerate(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { blob, filename } = await generateDocument(slug, { values, reviewNotes });
      // Object URL rather than a data: URI -- these run to a few hundred KB.
      //
      // The link has to be in the document before it is clicked (Firefox ignores click()
      // on a detached anchor) and the URL has to outlive the click (Safari aborts a
      // download whose blob URL is revoked in the same tick). Skipping either one shows
      // the success toast and saves no file.
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(`${filename} downloaded.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const blanks = (template?.fields || []).filter((f) => !String(values[f.name] || '').trim() && !f.default).length;

  if (!templates) {
    return (
      <div className="max-w-3xl space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <form onSubmit={handleGenerate} className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-text-h">Documents</h2>
        <p className="text-sm text-text/70">
          First drafts for attorney review. Nothing here has been checked by a legal practitioner —
          have these reviewed before you send one to a client.
        </p>
      </div>

      <Card className="space-y-4">
        <Field label="Document" hint={template?.blurb}>
          <Select value={slug} onValueChange={setSlug} placeholder="Choose a document">
            {templates.map((t) => (
              <SelectItem key={t.slug} value={t.slug}>
                {t.title}
              </SelectItem>
            ))}
          </Select>
        </Field>

        <Field
          label="Fill from an existing customer"
          hint="Optional. Fills in what the customer record knows; you still enter the legal name and registration number."
        >
          <Select value={clientId} onValueChange={applyClient} placeholder="Choose a customer">
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.company_name || c.full_name || c.email}
              </SelectItem>
            ))}
          </Select>
        </Field>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border-2 bg-raised/40 p-3">
          <input
            type="checkbox"
            checked={reviewNotes}
            onChange={(e) => setReviewNotes(e.target.checked)}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span className="text-xs text-text/70">
            <span className="font-medium text-text">Include attorney review notes</span>
            <br />
            Keep this on for the copy you send your attorney. Turn it off for the copy that goes to
            the client — it strips the review markers and the notes section.
          </span>
        </label>
      </Card>

      {template ? (
        <Card className="space-y-4">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-sm font-semibold text-text-h">{template.short} details</h3>
            <span className="text-xs text-text/50">
              {blanks ? `${blanks} of ${template.fields.length} still blank` : 'All fields filled'}
            </span>
          </div>
          <p className="text-xs text-text/50">
            Anything left blank prints as a ruled blank on the PDF, so a half-filled document comes
            out as a form you can complete by hand rather than a broken sentence.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {template.fields.map((field) => {
              const value = values[field.name] ?? '';
              const onChange = (e) => update({ ...values, [field.name]: e.target.value });
              const wide = field.type === 'textarea';
              const help = [field.hint, singleLineDefault(field) && `Defaults to "${field.default}".`]
                .filter(Boolean)
                .join(' ');
              return (
                <Field
                  key={field.name}
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      {field.label}
                      <Help text={help} />
                      {/* The one copy of the text a screen reader reads, at every width.
                          The visible mobile hint below is aria-hidden so it is not
                          announced twice on a phone. */}
                      <span className="sr-only">{help}</span>
                    </span>
                  }
                  hint={
                    <span className="sm:hidden" aria-hidden="true">
                      {help}
                    </span>
                  }
                  className={wide ? 'sm:col-span-2' : ''}
                >
                  {wide ? (
                    <textarea rows={3} value={value} onChange={onChange} className={textarea} />
                  ) : (
                    <Input
                      // Native date and number controls: the browser already validates and
                      // localises these better than anything worth writing here.
                      type={field.type === 'date' ? 'date' : field.type === 'money' ? 'number' : 'text'}
                      step={field.type === 'money' ? '0.01' : undefined}
                      value={value}
                      onChange={onChange}
                      placeholder={field.default || ''}
                    />
                  )}
                </Field>
              );
            })}
          </div>
        </Card>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || !slug}>
          {busy ? <FileText size={15} /> : <Download size={15} />}
          {busy ? 'Generating…' : 'Generate PDF'}
        </Button>
        <span className="text-xs text-text/50">
          Downloads to this device. Nothing is stored or emailed.
        </span>
      </div>
    </form>
  );
}
