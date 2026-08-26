import { supabase, API_BASE_URL } from './supabaseClient';

export function generatePassword() {
  // ponytail: hex-only (no 0/O or l/1 lookalikes) since this value gets read and retyped by hand
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function authedFetch(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...options.headers },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || 'Request failed');
  }
  return body;
}

export function createUser(payload) {
  return authedFetch('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
}

export function resetPassword(userId, password) {
  return authedFetch(`/api/admin/users/${userId}/password`, { method: 'PATCH', body: JSON.stringify({ password }) });
}

export function deleteUser(userId) {
  return authedFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
}

export function createSubscription(payload) {
  return authedFetch('/api/admin/subscriptions', { method: 'POST', body: JSON.stringify(payload) });
}

export function cancelSubscription(id) {
  return authedFetch(`/api/admin/subscriptions/${id}/cancel`, { method: 'PATCH' });
}

export function revokeSubscription(id) {
  return authedFetch(`/api/admin/subscriptions/${id}/revoke`, { method: 'PATCH' });
}

export function renewSubscription(id) {
  return authedFetch(`/api/admin/subscriptions/${id}/renew`, { method: 'PATCH' });
}

export function suspendSubscription(id) {
  return authedFetch(`/api/admin/subscriptions/${id}/suspend`, { method: 'PATCH' });
}

export function createWebsite(payload) {
  return authedFetch('/api/admin/websites', { method: 'POST', body: JSON.stringify(payload) });
}

export function updateSubscription(id, payload) {
  return authedFetch(`/api/admin/subscriptions/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export function updateWebsite(id, payload) {
  return authedFetch(`/api/admin/websites/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export function deleteWebsite(id) {
  return authedFetch(`/api/admin/websites/${id}`, { method: 'DELETE' });
}

// Invoices. Drafts are created and edited freely; everything from send onward is a
// state transition the API owns, because it also assigns the number and files the PDF.
export function createInvoice(payload) {
  return authedFetch('/api/admin/invoices', { method: 'POST', body: JSON.stringify(payload) });
}

export function updateInvoice(id, payload) {
  return authedFetch(`/api/admin/invoices/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export function sendInvoice(id) {
  return authedFetch(`/api/admin/invoices/${id}/send`, { method: 'POST' });
}

export function payInvoice(id, payload) {
  return authedFetch(`/api/admin/invoices/${id}/pay`, { method: 'POST', body: JSON.stringify(payload) });
}

export function voidInvoice(id, reason) {
  return authedFetch(`/api/admin/invoices/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
}

// Signed on request rather than stored, so the link can't be a dead one by the time it's clicked.
export function getInvoicePdfUrl(id, doc) {
  return authedFetch(`/api/admin/invoices/${id}/pdf${doc === 'receipt' ? '?doc=receipt' : ''}`);
}

// The one Finance call that can't go straight to Supabase from the browser: the Paystack
// secret key is a server secret. Everything else on that page still reads and writes the
// table directly. Sent with no window -- the server defaults to the last 90 days.
export function syncPaystack() {
  return authedFetch('/api/admin/finance/paystack-sync', { method: 'POST', body: '{}' });
}

// Whole payload forwarded rather than picked apart: location/industry plus maxResults
// and, when searching near you, latitude/longitude/radius. Rebuilding the body from a
// destructured subset silently drops every field added later.
export function searchLeads(payload) {
  return authedFetch('/api/leads/search', { method: 'POST', body: JSON.stringify(payload) });
}

export function getLeadSearchUsage() {
  return authedFetch('/api/leads/usage');
}

// Returns the lead row whether it was created or already existed, so the finder can log
// a call against it straight away.
export function importOneLead(lead) {
  return authedFetch('/api/leads/import-one', { method: 'POST', body: JSON.stringify({ lead }) });
}

export function logLeadActivity(leadId, payload) {
  return authedFetch(`/api/leads/${leadId}/activities`, { method: 'POST', body: JSON.stringify(payload) });
}

export function updateLead(leadId, payload) {
  return authedFetch(`/api/leads/${leadId}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export function deleteLead(leadId) {
  return authedFetch(`/api/leads/${leadId}`, { method: 'DELETE' });
}

// Progress is computed server-side, so goals are fetched through the API rather than
// read straight from supabase like the other lists on the page.
export function getLeadGoals(includeArchived) {
  return authedFetch(`/api/leads/goals${includeArchived ? '?archived=true' : ''}`);
}

export function createLeadGoal(payload) {
  return authedFetch('/api/leads/goals', { method: 'POST', body: JSON.stringify(payload) });
}

export function updateLeadGoal(id, payload) {
  return authedFetch(`/api/leads/goals/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export function deleteLeadGoal(id) {
  return authedFetch(`/api/leads/goals/${id}`, { method: 'DELETE' });
}

export function createLeadCategory(name) {
  return authedFetch('/api/leads/categories', { method: 'POST', body: JSON.stringify({ name }) });
}

export function deleteLeadCategory(name) {
  return authedFetch(`/api/leads/categories/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// Client documents. The catalogue drives the form; the PDF comes back as a download rather
// than a stored file, so there is no id to fetch it by later -- generate it again if needed.
export function listDocumentTemplates() {
  return authedFetch('/api/admin/documents');
}

// Not authedFetch: that helper always parses JSON, and this response is a PDF.
export async function generateDocument(slug, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API_BASE_URL}/api/admin/documents/${slug}/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not generate the document');
  }
  const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
  return { blob: await res.blob(), filename: match ? match[1] : `${slug}.pdf` };
}

// QR codes. The printed code redirects through our own domain, so the destination stays
// editable after the cards are printed -- see src/db/qr_codes.sql.
export function createQrCode(payload) {
  return authedFetch('/api/admin/qr', { method: 'POST', body: JSON.stringify(payload) });
}

export function updateQrCode(id, payload) {
  return authedFetch(`/api/admin/qr/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

// Not authedFetch, for the same reason generateDocument isn't: that helper always parses
// JSON and this is an image. The blob serves both the preview and the save button -- an
// <img src> can't carry a bearer token, and QR Code Monkey's CORS header is pinned to its
// own site, so the browser can never fetch the image directly either way.
export async function fetchQrImage(id, format) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API_BASE_URL}/api/admin/qr/${id}/image?format=${format}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not generate the QR code');
  }
  const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
  return { blob: await res.blob(), filename: match ? match[1] : `qr.${format}` };
}
