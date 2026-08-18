// Run by the root `npm test` (`node --test`). Pure functions, no react, no supabase.
import test from 'node:test';
import assert from 'node:assert';
import { matchesFilter, isOverdue } from './invoices.js';

const inv = (status, due_date) => ({ status, due_date });

test('outstanding is drafts and sent, never paid or void', () => {
  assert.equal(matchesFilter(inv('draft'), 'outstanding'), true);
  assert.equal(matchesFilter(inv('sent'), 'outstanding'), true);
  assert.equal(matchesFilter(inv('paid'), 'outstanding'), false);
  assert.equal(matchesFilter(inv('void'), 'outstanding'), false);
});

test('all shows everything, a status filter shows only itself', () => {
  for (const s of ['draft', 'sent', 'paid', 'void']) assert.equal(matchesFilter(inv(s), 'all'), true);
  assert.equal(matchesFilter(inv('paid'), 'paid'), true);
  assert.equal(matchesFilter(inv('sent'), 'paid'), false);
});

test('overdue is sent and past due, exclusive of today', () => {
  assert.equal(isOverdue(inv('sent', '2026-08-16'), '2026-08-17'), true);
  assert.equal(isOverdue(inv('sent', '2026-08-17'), '2026-08-17'), false, 'due today is not yet overdue');
  assert.equal(isOverdue(inv('draft', '2026-01-01'), '2026-08-17'), false, 'an unissued draft is not overdue');
  assert.equal(isOverdue(inv('paid', '2026-01-01'), '2026-08-17'), false);
});
