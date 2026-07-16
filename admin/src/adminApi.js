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

export function createUser({ email, password, fullName }) {
  return authedFetch('/api/admin/users', { method: 'POST', body: JSON.stringify({ email, password, fullName }) });
}

export function resetPassword(userId, password) {
  return authedFetch(`/api/admin/users/${userId}/password`, { method: 'PATCH', body: JSON.stringify({ password }) });
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
