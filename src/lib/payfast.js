const crypto = require('crypto');

// Payfast API v1.
//
// The merchant KEY is not used here at all -- that one is only for payment forms. API
// calls authenticate on merchant-id plus a PASSPHRASE, which is a separate value you set
// yourself under Settings -> Security in the Payfast dashboard. If no passphrase is set on
// the account, every call comes back unauthorised no matter what is sent.
//
// Override the base URL to point at the sandbox; live and sandbox have different
// merchant ids AND different passphrases, so they never work against each other.
const API_BASE = process.env.PAYFAST_API_BASE || 'https://api.payfast.co.za';

// md5 of every header AND query value plus the passphrase, alphabetised, lowercase hex.
// Spaces encode as '+' rather than %20 -- Payfast's own hash does it that way, and that
// single difference is the whole of "Generated signature does not match submitted
// signature", which is the error you will otherwise spend an afternoon on.
function signature(params, passphrase) {
  const all = { ...params, passphrase };
  const uri = Object.keys(all)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(all[k]).replace(/%20/g, '+')}`)
    .join('&');
  return crypto.createHash('md5').update(uri).digest('hex');
}

// Seconds precision. Payfast rejects a timestamp carrying milliseconds.
const stamp = (now = new Date()) => now.toISOString().split('.')[0];

// The query string is signed along with the headers, so `query` here must be exactly what
// goes on the URL -- sign one window and request another and the call is rejected.
function authHeaders({ merchantId, passphrase, query = {}, timestamp = stamp() }) {
  const headers = { 'merchant-id': merchantId, version: 'v1', timestamp };
  return { ...headers, signature: signature({ ...headers, ...query }, passphrase) };
}

// Header names are matched loosely -- 'Gross', 'gross' and 'AMOUNT GROSS' all collapse to
// the same key -- because the exact casing of Payfast's history columns is the one thing
// in this file that has not been verified against a live merchant account.
const key = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

const normalise = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [key(k), v]));

function pick(row, ...names) {
  for (const name of names) {
    const value = row[key(name)];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

// Quote-aware, because a description containing a comma is not hypothetical. Embedded
// newlines are not handled -- one would split into a junk row, which then fails the
// mapping check in the sync route loudly rather than importing a wrong amount.
// ponytail: reach for a real CSV parser only if that actually happens.
function splitRow(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      cells.push(cell);
      cell = '';
    } else cell += c;
  }
  cells.push(cell);
  return cells.map((s) => s.trim());
}

function parseCsv(text) {
  const lines = String(text)
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 2) return [];
  const header = splitRow(lines[0]).map(key);
  return lines.slice(1).map((line) => Object.fromEntries(splitRow(line).map((v, i) => [header[i], v])));
}

// Payfast wraps responses as {status, data: {response}}. On this endpoint `response` is a
// CSV blob, but the community SDKs show it as an array of objects on some accounts, so
// both shapes are accepted rather than betting on which one yours returns.
function parseHistory(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return parseCsv(text);
  }
  const payload = body?.data?.response ?? body?.data ?? body;
  if (typeof payload === 'string') return parseCsv(payload);
  return Array.isArray(payload) ? payload : [];
}

// 'R 1,234.56' and '1234.56' both land on 1234.56. Currency symbols and thousands
// separators are stripped rather than parsed -- ZAR only, so there is no locale to detect.
function amount(value) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// occurred_on is a plain `date`, and admin/src/lib/finance.js compares those AS STRINGS.
//
// A timezone-less 'YYYY-MM-DD...' is taken verbatim, because Payfast reports South African
// times to South African merchants -- the date it printed is the date it means, and
// round-tripping it through a Date is exactly how 01:00 in Johannesburg becomes yesterday.
//
// The order matters and is the whole subtlety: a value carrying an explicit Z or ±HH:MM is
// checked FIRST and genuinely parsed, because there its leading date is UTC's answer, not
// ours -- 22:30Z on the 16th is already the 17th here. Either way the result is resolved
// in SAST ('en-CA' being the ISO-shaped locale), never in the server's UTC.
function occurredOn(value) {
  const text = String(value ?? '').trim();
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const iso = text.match(/^\d{4}-\d{2}-\d{2}/);
  if (iso && !zoned) return iso[0];
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
}

// Money moving between the merchant's OWN accounts, which is not income and not an expense.
// A TOPUP is a credit card funding the Payfast wallet: booking it as 'in' invents revenue
// out of a transfer, and then the purchase it funds books as 'out' too, so a single R49
// hosting payment would show up as R49 earned AND R49 spent. Only the spend is real.
//
// WITHDRAWAL (wallet -> bank) is deliberately NOT in here: this account has never held
// customer money, so there is no withdrawal to classify and no evidence to guess from.
// ponytail: if customers ever start paying in, the withdrawal is the leg that actually
// touches the bank -- decide then whether it, or the payments, is what the ledger records.
const TRANSFER_TYPES = new Set(['TOPUP']);

// One Payfast transaction becomes up to two ledger rows: the gross, and Payfast's cut as
// its own expense. See src/db/payfast.sql for why the fee is split out rather than netted.
//
// A row with neither an id nor a usable date is skipped -- it cannot be deduplicated, so
// importing it would mean a duplicate on every subsequent sync.
function toEntries(transactions) {
  const rows = [];
  for (const raw of transactions || []) {
    const t = normalise(raw);
    const id = pick(t, 'pf_payment_id', 'm_payment_id', 'payment_id', 'id');
    const on = occurredOn(pick(t, 'date', 'transaction_date', 'created', 'timestamp'));
    if (!id || !on) continue;

    const type = String(pick(t, 'type') || '').toUpperCase();
    if (TRANSFER_TYPES.has(type)) continue;

    const gross = amount(pick(t, 'gross', 'amount_gross', 'amount'));
    const fee = Math.abs(amount(pick(t, 'fee', 'amount_fee')));
    const sign = String(pick(t, 'sign') || '').toUpperCase();

    // Party first: "Host Africa (Pty) Ltd" is what you need to see in the ledger, where
    // Payfast's own Description is an invoice reference you have no other use for.
    const description =
      [pick(t, 'party'), pick(t, 'description', 'item_name', 'name')].filter(Boolean).join(' — ') || 'Payfast';

    // Sign is Payfast stating the direction outright, so it wins; the gross sign is only a
    // fallback for a response that omits the column. Either way `direction` carries it,
    // because the amount column rejects anything <= 0 -- a negative 'out' would silently
    // ADD to the balance, which finance.sql calls the one arithmetic mistake it must make
    // impossible.
    //
    // No category is guessed. An 'out' is not necessarily a refund (the only one in this
    // account is a hosting bill), and a wrong category is worse than a blank one you fill
    // in -- the whole point of leaving categories editable on a synced row.
    const direction = sign === 'CREDIT' ? 'in' : sign === 'DEBIT' ? 'out' : gross > 0 ? 'in' : 'out';

    // Type and sign are part of the key because Payfast reuses ONE PF Payment ID across
    // both legs of a transaction -- the topup and the purchase it funds share id
    // 320759399. Keyed on the id alone, the unique index silently swallows one of them.
    // ponytail: two rows sharing id AND type AND sign on one day would still collide. Add
    // the timestamp if that ever shows up -- not sooner, since a formatting change on
    // Payfast's side would re-import the entire history as new rows.
    const externalId = `${id}:${type || 'NA'}:${sign || 'NA'}`;

    if (gross) {
      rows.push({
        occurred_on: on,
        direction,
        amount: Math.abs(gross),
        category: null,
        description,
        source: 'payfast',
        external_id: externalId,
      });
    }
    if (fee) {
      rows.push({
        occurred_on: on,
        direction: 'out',
        amount: fee,
        category: 'Payfast fees',
        description,
        source: 'payfast',
        external_id: `${externalId}:fee`,
      });
    }
  }
  return rows;
}

async function fetchHistory({ from, to, merchantId, passphrase }) {
  const query = { from, to };
  const res = await fetch(`${API_BASE}/transactions/history?${new URLSearchParams(query)}`, {
    headers: authHeaders({ merchantId, passphrase, query }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Payfast returned ${res.status}: ${text.slice(0, 200)}`);
  }
  return parseHistory(text);
}

module.exports = { signature, authHeaders, parseCsv, parseHistory, occurredOn, toEntries, fetchHistory };
