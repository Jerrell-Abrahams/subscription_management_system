import { useEffect, useMemo, useState } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { supabase } from '../supabaseClient';
import { Card } from '../components/ui/Card';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { STATUS_CHART_COLORS } from '../components/ui/Badge';
import { Select, SelectItem } from '../components/ui/Select';

const RANGES = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  all: null,
};

const STATUS_ORDER = ['pending', 'active', 'past_due', 'canceled', 'expired', 'revoked'];

export function Analytics() {
  const [events, setEvents] = useState([]);
  const [statusBreakdown, setStatusBreakdown] = useState([]);
  const [range, setRange] = useState('7d');

  useEffect(() => {
    (async () => {
      const [{ data: eventRows }, { data: subRows }] = await Promise.all([
        supabase
          .from('analytics_events')
          .select('*, app_users(email), products(name)')
          .order('created_at', { ascending: false })
          .limit(100),
        supabase.from('subscriptions').select('status'),
      ]);
      setEvents(eventRows || []);

      const tally = {};
      (subRows || []).forEach((r) => { tally[r.status] = (tally[r.status] || 0) + 1; });
      setStatusBreakdown(STATUS_ORDER.map((status) => ({ status, count: tally[status] || 0 })).filter((s) => s.count > 0));
    })();
  }, []);

  const filteredEvents = useMemo(() => {
    const windowMs = RANGES[range];
    if (!windowMs) return events;
    const cutoff = Date.now() - windowMs;
    return events.filter((e) => new Date(e.created_at).getTime() >= cutoff);
  }, [events, range]);

  const eventsByDay = useMemo(() => {
    const tally = {};
    filteredEvents.forEach((e) => {
      const day = e.created_at.slice(0, 10);
      tally[day] = (tally[day] || 0) + 1;
    });
    return Object.entries(tally)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));
  }, [filteredEvents]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-text-h">Analytics</h2>
        <Select value={range} onValueChange={setRange} className="w-40">
          <SelectItem value="24h">Last 24h</SelectItem>
          <SelectItem value="7d">Last 7 days</SelectItem>
          <SelectItem value="30d">Last 30 days</SelectItem>
          <SelectItem value="all">All time</SelectItem>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-text-h">Events over time</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={eventsByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" stroke="var(--color-text)" fontSize={11} />
                <YAxis allowDecimals={false} stroke="var(--color-text)" fontSize={12} />
                <Tooltip contentStyle={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 8 }} />
                <Area type="monotone" dataKey="count" stroke="var(--color-accent)" fill="var(--color-accent)" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-text-h">Subscriptions by status</h3>
          <div className="h-56">
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
      </div>

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-text-h">
          Recent events <span className="font-normal text-text/70">({filteredEvents.length})</span>
        </h3>
        <Table>
          <Thead>
            <Tr><Th>Event</Th><Th>User</Th><Th>Product</Th><Th>Payload</Th><Th>Time</Th></Tr>
          </Thead>
          <Tbody>
            {filteredEvents.map((e) => (
              <Tr key={e.id}>
                <Td>{e.event_type}</Td>
                <Td>{e.app_users?.email}</Td>
                <Td>{e.products?.name}</Td>
                <Td>
                  <pre className="max-h-40 max-w-xs overflow-auto rounded bg-bg-alt p-2 text-xs">{JSON.stringify(e.payload, null, 2)}</pre>
                </Td>
                <Td>{new Date(e.created_at).toLocaleString()}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>
    </div>
  );
}
