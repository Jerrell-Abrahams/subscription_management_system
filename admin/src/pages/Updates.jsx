import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { Input } from '../components/ui/Input';
import { Select, SelectItem } from '../components/ui/Select';

export function Updates() {
  const [updates, setUpdates] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ productId: '', version: '', downloadUrl: '', releaseNotes: '' });

  async function load() {
    const [{ data: updateRows }, { data: productRows }] = await Promise.all([
      supabase.from('updates').select('*, products(name)').order('published_at', { ascending: false }),
      supabase.from('products').select('id, name').order('name'),
    ]);
    setUpdates(updateRows || []);
    setProducts(productRows || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.productId || !form.version || !form.downloadUrl) {
      toast.error('Product, version, and download URL are required.');
      return;
    }
    const { error } = await supabase.from('updates').insert({
      product_id: form.productId,
      version: form.version,
      download_url: form.downloadUrl,
      release_notes: form.releaseNotes,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Update published.');
    setForm({ productId: '', version: '', downloadUrl: '', releaseNotes: '' });
    load();
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-text-h">
        Updates <span className="text-sm font-normal text-text/70">({updates.length})</span>
      </h2>

      <Card>
        <form onSubmit={handleCreate} className="flex flex-wrap items-center gap-2">
          <Select value={form.productId} onValueChange={(v) => setForm({ ...form, productId: v })} placeholder="Select product…" className="w-auto min-w-[160px]">
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </Select>
          <Input
            placeholder="Version (e.g. 1.3.0)"
            value={form.version}
            onChange={(e) => setForm({ ...form, version: e.target.value })}
            required
            className="w-auto"
          />
          <Input
            placeholder="Download URL"
            value={form.downloadUrl}
            onChange={(e) => setForm({ ...form, downloadUrl: e.target.value })}
            required
            className="min-w-[220px] flex-1"
          />
          <Input
            placeholder="Release notes"
            value={form.releaseNotes}
            onChange={(e) => setForm({ ...form, releaseNotes: e.target.value })}
            className="min-w-[220px] flex-1"
          />
          <Button type="submit">Publish</Button>
        </form>
      </Card>

      <Table>
        <Thead>
          <Tr><Th>Product</Th><Th>Version</Th><Th>Notes</Th><Th>Published</Th></Tr>
        </Thead>
        <Tbody>
          {updates.map((u) => (
            <Tr key={u.id}>
              <Td>{u.products?.name}</Td>
              <Td>
                <a href={u.download_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                  {u.version} <ExternalLink size={12} />
                </a>
              </Td>
              <Td>{u.release_notes}</Td>
              <Td>{new Date(u.published_at).toLocaleString()}</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </div>
  );
}
