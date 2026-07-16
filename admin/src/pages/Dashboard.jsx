import { useEffect, useState } from 'react';
import { Users, CreditCard, Activity, PlugZap } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { supabase } from '../supabaseClient';
import { Card } from '../components/ui/Card';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { STATUS_CHART_COLORS } from '../components/ui/Badge';

const STATUS_ORDER = ['pending', 'active', 'past_due', 'canceled', 'expired', 'revoked'];

function KpiCard({ icon: Icon, label, value }) {
  return (
    <Card className="flex items-center gap-3">
      <div className="rounded-lg bg-accent/10 p-2 text-accent">
        <Icon size={20} />
      </div>
      <div>
        <p className="text-xs text-text/70">{label}</p>
        <p className="text-xl font-semibold text-text-h">{value}</p>
      </div>
    </Card>
  );
}

export function Dashboard() {
  const [counts, setCounts] = useState({ users: 0, active: 0, total: 0, recentActivations: 0 });
  const [statusBreakdown, setStatusBreakdown] = useState([]);
  const [recentActivations, setRecentActivations] = useState([]);
  const [recentEvents, setRecentEvents] = useState([]);

  useEffect(() => {
    async function load() {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [{ count: users }, { count: active }, { count: total }, { count: recentActivationsCount }, { data: statusRows }] =
        await Promise.all([
          supabase.from('app_users').select('*', { count: 'exact', head: true }),
          supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
          supabase.from('subscriptions').select('*', { count: 'exact', head: true }),
          supabase.from('activations').select('*', { count: 'exact', head: true }).gte('activated_at', sevenDaysAgo),
          supabase.from('subscriptions').select('status'),
        ]);
      setCounts({ users: users || 0, active: active || 0, total: total || 0, recentActivations: recentActivationsCount || 0 });

      const tally = {};
      (statusRows || []).forEach((r) => { tally[r.status] = (tally[r.status] || 0) + 1; });
      setStatusBreakdown(STATUS_ORDER.map((status) => ({ status, count: tally[status] || 0 })).filter((s) => s.count > 0));

      const [{ data: activations }, { data: events }] = await Promise.all([
        supabase
          .from('activations')
          .select('id, device_name, activated_at, subscriptions(app_users(email), products(name))')
          .order('activated_at', { ascending: false })
          .limit(5),
        supabase
          .from('analytics_events')
          .select('id, event_type, created_at, app_users(email), products(name)')
          .order('created_at', { ascending: false })
          .limit(5),
      ]);
      setRecentActivations(activations || []);
      setRecentEvents(events || []);
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-text-h">Dashboard</h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Users} label="Total users" value={counts.users} />
        <KpiCard icon={CreditCard} label="Active subscriptions" value={counts.active} />
        <KpiCard icon={Activity} label="Total subscriptions" value={counts.total} />
        <KpiCard icon={PlugZap} label="Activations (7d)" value={counts.recentActivations} />
      </div>

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-text-h">Subscriptions by status</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={statusBreakdown}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="status" stroke="var(--color-text)" fontSize={12} />
              <YAxis allowDecimals={false} stroke="var(--color-text)" fontSize={12} />
              <Tooltip contentStyle={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 8 }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {statusBreakdown.map((entry) => (
                  <Cell key={entry.status} fill={STATUS_CHART_COLORS[entry.status]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-text-h">Recent activations</h3>
          <Table>
            <Thead>
              <Tr><Th>User</Th><Th>Product</Th><Th>Device</Th><Th>When</Th></Tr>
            </Thead>
            <Tbody>
              {recentActivations.map((a) => (
                <Tr key={a.id}>
                  <Td>{a.subscriptions?.app_users?.email}</Td>
                  <Td>{a.subscriptions?.products?.name}</Td>
                  <Td>{a.device_name || '—'}</Td>
                  <Td>{new Date(a.activated_at).toLocaleString()}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-text-h">Recent analytics events</h3>
          <Table>
            <Thead>
              <Tr><Th>Event</Th><Th>User</Th><Th>Product</Th><Th>When</Th></Tr>
            </Thead>
            <Tbody>
              {recentEvents.map((e) => (
                <Tr key={e.id}>
                  <Td>{e.event_type}</Td>
                  <Td>{e.app_users?.email}</Td>
                  <Td>{e.products?.name}</Td>
                  <Td>{new Date(e.created_at).toLocaleString()}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
