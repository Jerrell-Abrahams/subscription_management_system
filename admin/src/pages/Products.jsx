import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../supabaseClient';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { Input } from '../components/ui/Input';

export function Products() {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ slug: '', name: '' });

  async function load() {
    const { data } = await supabase.from('products').select('*').order('created_at', { ascending: false });
    setProducts(data || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    const { error } = await supabase.from('products').insert(form);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Product added.');
    setForm({ slug: '', name: '' });
    load();
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-text-h">
        Products <span className="text-sm font-normal text-text/70">({products.length})</span>
      </h2>

      <Card>
        <form onSubmit={handleCreate} className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            className="w-auto"
          />
          <Input
            placeholder="Slug"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            required
            className="w-auto"
          />
          <Button type="submit">Add product</Button>
        </form>
      </Card>

      <Table>
        <Thead>
          <Tr><Th>Name</Th><Th>Slug</Th><Th>Created</Th></Tr>
        </Thead>
        <Tbody>
          {products.map((p) => (
            <Tr key={p.id}>
              <Td>{p.name}</Td>
              <Td className="font-mono text-xs">{p.slug}</Td>
              <Td>{new Date(p.created_at).toLocaleDateString()}</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </div>
  );
}
