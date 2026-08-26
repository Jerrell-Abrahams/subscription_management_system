import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Copy, Pencil, Search, QrCode as QrIcon, ExternalLink, Download } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { createQrCode, updateQrCode, fetchQrImage } from '../adminApi';
import { Button, IconButton } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { Skeleton, SkeletonRows } from '../components/ui/Skeleton';
import { Badge } from '../components/ui/Badge';
import { Field, Input } from '../components/ui/Input';
import { Select, SelectItem } from '../components/ui/Select';

// Must match QR_BASE_URL on the API project -- this page reads its rows straight from
// Supabase rather than through the API, so it has no server-side value to borrow. Both
// default to the same host, so they only diverge if someone changes one and not the other.
const QR_BASE = (import.meta.env.VITE_QR_BASE_URL || 'https://qr.complexai.co.za').replace(/\/+$/, '');
const scanUrl = (code) => `${QR_BASE}/${code}`;

const DAYS = 30;

const emptyForm = { label: '', websiteId: '', destination: '' };

// The stored rows are sparse -- a day with no scans has no row at all -- so the gaps are
// filled here rather than in SQL. UTC throughout, because that is what record_qr_scan
// writes; taking local dates here would shift every bucket by a day for half the year.
function last30(scans) {
  const byDay = new Map((scans || []).map((s) => [s.day, s.hits]));
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: DAYS }, (_, i) => {
    const day = new Date(today - (DAYS - 1 - i) * 86400000).toISOString().slice(0, 10);
    return { day, hits: byDay.get(day) || 0 };
  });
}

const totalScans = (scans) => (scans || []).reduce((sum, s) => sum + s.hits, 0);

// Hand-drawn rather than a Recharts import: it is a polyline over a fixed 30 slots with no
// axes, no tooltip and no legend, and pulling in a chart library to draw one <polyline>
// would be the expensive way to get the same pixels.
function Sparkline({ series }) {
  const max = Math.max(1, ...series.map((d) => d.hits));
  const points = series
    .map((d, i) => `${(i / (series.length - 1)) * 100},${28 - (d.hits / max) * 26}`)
    .join(' ');
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-8 w-full" aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// The link has to be in the document before it is clicked (Firefox ignores click() on a
// detached anchor) and the URL has to outlive the click (Safari aborts a download whose
// blob URL is revoked in the same tick). Lifted from Documents.jsx, same two rules.
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function QrCodes() {
  const [codes, setCodes] = useState(null); // null = not loaded, [] = loaded empty
  const [websites, setWebsites] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState(null); // { row, url, blob } -- url null while rendering
  const [savingSvg, setSavingSvg] = useState(false);

  // Surfaced rather than swallowed, matching Websites and Finance: an empty table and a
  // failed query look identical otherwise, which hides an unrun migration behind
  // "no QR codes yet".
  async function load() {
    const [{ data: rows, error }, { data: siteRows }] = await Promise.all([
      supabase
        .from('qr_codes')
        .select('id, code, label, destination, active, created_at, website_id, websites(domain), qr_scans(day, hits)')
        .order('created_at', { ascending: false }),
      supabase.from('websites').select('id, domain').order('domain'),
    ]);
    if (error) {
      setLoadError(error.message);
      return;
    }
    setLoadError(null);
    setCodes(rows || []);
    setWebsites(siteRows || []);
  }

  useEffect(() => {
    load();
  }, []);

  const loading = codes === null;
  const rows = codes ?? [];
  const filtered = rows.filter((r) => {
    const q = search.toLowerCase();
    return r.label.toLowerCase().includes(q) || r.code.includes(q) || r.destination.toLowerCase().includes(q);
  });
  const scansAllTime = rows.reduce((sum, r) => sum + totalScans(r.qr_scans), 0);

  // Renders through the API because QR Code Monkey pins its CORS header to its own site.
  // One blob covers the preview and the PNG download; the SVG is a second render because
  // it is a different file, not a different view of this one.
  async function openPreview(row) {
    setPreview({ row, url: null, blob: null });
    try {
      const { blob, filename } = await fetchQrImage(row.id, 'png');
      setPreview({ row, url: URL.createObjectURL(blob), blob, filename });
    } catch (err) {
      toast.error(err.message);
      setPreview(null);
    }
  }

  function closePreview() {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const created = await createQrCode({
        label: form.label,
        destination: form.destination,
        websiteId: form.websiteId || null,
      });
      setShowForm(false);
      setForm(emptyForm);
      await load();
      toast.success(`Code ${created.code} created.`);
      // Straight into the preview: the point of pressing the button is to see the QR, and
      // the row it just made is the only one anybody wants to look at.
      openPreview(created);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEdit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await updateQrCode(editing.id, {
        label: editing.label,
        destination: editing.destination,
        websiteId: editing.website_id || null,
      });
      toast.success('QR code updated. Anything already printed now points at the new address.');
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(row) {
    try {
      await updateQrCode(row.id, { active: !row.active });
      toast.success(row.active ? 'Code retired.' : 'Code reactivated.');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function copyLink(row) {
    await navigator.clipboard.writeText(scanUrl(row.code));
    toast.success('Scan link copied.');
  }

  async function saveSvg(row) {
    setSavingSvg(true);
    try {
      const { blob, filename } = await fetchQrImage(row.id, 'svg');
      saveBlob(blob, filename);
      toast.success(`${filename} downloaded.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingSvg(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-text-h">QR codes</h2>
        <Card className="border-red-500/40 bg-red-500/5 text-sm">
          <p className="font-medium text-red-600 dark:text-red-400">QR codes couldn&apos;t load</p>
          <p className="mt-1 text-text/70">{loadError}</p>
          <p className="mt-1 text-xs text-text/60">
            If this mentions a missing table, run <code>src/db/qr_codes.sql</code> in the Supabase SQL editor.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-text-h">
          QR codes{' '}
          {loading ? (
            <Skeleton className="inline-block h-3 w-36 align-middle" />
          ) : (
            <span className="text-sm font-normal text-text/70">
              ({rows.length} code{rows.length === 1 ? '' : 's'} · {scansAllTime} scan
              {scansAllTime === 1 ? '' : 's'})
            </span>
          )}
        </h2>
        <Button onClick={() => setShowForm(true)}>
          <Plus size={16} /> New QR code
        </Button>
      </div>

      <Input
        icon={Search}
        placeholder="Search by label, code or destination…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-[30px] max-w-xs"
      />

      <Table>
        <Thead>
          <Tr>
            <Th>Label</Th>
            <Th>Code</Th>
            <Th>Points to</Th>
            <Th>Scans</Th>
            <Th>Last 30 days</Th>
            <Th>Actions</Th>
          </Tr>
        </Thead>
        <Tbody>
          {loading && <SkeletonRows cols={6} actions />}
          {filtered.map((r) => (
            <Tr key={r.id} className="hover:bg-bg-alt/60">
              <Td>
                <button onClick={() => openPreview(r)} className="text-accent hover:underline">
                  {r.label}
                </button>
                {!r.active && <Badge className="ml-2">retired</Badge>}
              </Td>
              <Td>
                <code className="font-mono text-[12px] text-muted">/{r.code}</code>
              </Td>
              <Td className="max-w-[22rem] truncate">
                <a href={r.destination} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  {r.destination}
                </a>
                {r.websites?.domain && <Badge className="ml-2">{r.websites.domain}</Badge>}
              </Td>
              <Td>{totalScans(r.qr_scans)}</Td>
              <Td className="w-40">
                <Sparkline series={last30(r.qr_scans)} />
              </Td>
              <Td>
                <div className="flex items-center gap-1.5">
                  <IconButton onClick={() => openPreview(r)} title="Preview and download">
                    <QrIcon size={15} />
                  </IconButton>
                  <IconButton onClick={() => copyLink(r)} title="Copy scan link">
                    <Copy size={15} />
                  </IconButton>
                  <IconButton onClick={() => setEditing({ ...r })} title="Edit">
                    <Pencil size={15} />
                  </IconButton>
                  <Button
                    variant={r.active ? 'destructive' : 'secondary'}
                    className="h-8 px-2.5 text-[12px]"
                    onClick={() => toggleActive(r)}
                  >
                    {r.active ? 'Retire' : 'Restore'}
                  </Button>
                </div>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>

      {!loading && filtered.length === 0 && (
        <p className="text-sm text-text/60">
          {rows.length === 0 ? 'No QR codes yet.' : 'Nothing matches that search.'}
        </p>
      )}

      <Modal open={showForm} onOpenChange={setShowForm} title="New QR code">
        <form onSubmit={handleCreate} className="space-y-3">
          <Field label="Label" hint="What this code is for. Shows up in the filename.">
            <Input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Sipho's Barber — table tent"
              required
            />
          </Field>

          <Field
            label="Website (optional)"
            hint="Attaches the code to a client's site and fills in the destination."
            as="div"
          >
            <Select
              value={form.websiteId || 'none'}
              onValueChange={(id) => {
                const site = websites.find((w) => w.id === id);
                setForm({
                  ...form,
                  websiteId: id === 'none' ? '' : id,
                  destination: site ? `https://${site.domain}` : form.destination,
                });
              }}
              placeholder="Not tied to a website"
            >
              <SelectItem value="none">Not tied to a website</SelectItem>
              {websites.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.domain}
                </SelectItem>
              ))}
            </Select>
          </Field>

          <Field label="Destination" hint="Where a scan lands. Changeable later without reprinting.">
            <Input
              value={form.destination}
              onChange={(e) => setForm({ ...form, destination: e.target.value })}
              placeholder="https://example.co.za"
              required
            />
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Generating…' : 'Generate'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!editing} onOpenChange={(open) => !open && setEditing(null)} title="Edit QR code">
        {editing && (
          <form onSubmit={handleEdit} className="space-y-3">
            <p className="rounded-md border border-border-2 bg-raised px-3 py-2 text-xs text-text/70">
              The printed code stays <code className="font-mono">/{editing.code}</code>. Only where it sends people
              changes.
            </p>

            <Field label="Label">
              <Input
                value={editing.label}
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                required
              />
            </Field>

            <Field label="Website (optional)" as="div">
              <Select
                value={editing.website_id || 'none'}
                onValueChange={(id) => setEditing({ ...editing, website_id: id === 'none' ? '' : id })}
                placeholder="Not tied to a website"
              >
                <SelectItem value="none">Not tied to a website</SelectItem>
                {websites.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.domain}
                  </SelectItem>
                ))}
              </Select>
            </Field>

            <Field label="Destination">
              <Input
                value={editing.destination}
                onChange={(e) => setEditing({ ...editing, destination: e.target.value })}
                required
              />
            </Field>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!preview} onOpenChange={(open) => !open && closePreview()} title={preview?.row.label || 'QR code'}>
        {preview && (
          <div className="space-y-3">
            {/* White plate regardless of theme: the QR is generated on a white background,
                so dropping it on a dark panel would ring it with a bright square. */}
            <div className="flex items-center justify-center rounded-lg border border-border bg-white p-4">
              {preview.url ? (
                <img src={preview.url} alt={`QR code for ${preview.row.label}`} className="h-56 w-56" />
              ) : (
                <Skeleton className="h-56 w-56" />
              )}
            </div>

            <div className="space-y-1 text-xs text-text/70">
              <p>
                Encodes <code className="font-mono text-muted">{scanUrl(preview.row.code)}</code>
              </p>
              <p className="flex items-center gap-1">
                <ExternalLink size={12} /> Redirects to {preview.row.destination}
              </p>
            </div>

            {/* QR Code Monkey exposes no error-correction setting and picks it itself once a
                logo is involved, so scannability is not something this screen can promise. */}
            <p className="rounded-md border border-warn/35 bg-warn/8 px-3 py-2 text-xs text-warn">
              Scan this with your phone before sending it to print. Keep it at least 3cm wide on paper.
            </p>

            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={!preview.blob}
                onClick={() => {
                  saveBlob(preview.blob, preview.filename);
                  toast.success(`${preview.filename} downloaded.`);
                }}
              >
                <Download size={15} /> PNG
              </Button>
              <Button disabled={savingSvg} onClick={() => saveSvg(preview.row)}>
                <Download size={15} /> {savingSvg ? 'Rendering…' : 'SVG'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
