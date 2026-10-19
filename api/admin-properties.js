// Server-side proxy for the SwapSpace backend's property-moderation API
// (/api/internal/admin/properties). Same shape as /api/email-tracking: the
// browser authenticates here with the admin's Supabase JWT, and this handler
// adds the internal API key, which never leaves the server.
//
// It also sends X-Admin-Email: the backend records every moderation action
// under that email in its audit log. The backend trusts the header because
// only a holder of the internal key can send it.
//
// One URL maps to one file, so the operation is picked from method + query:
//   GET    ?search=&published=&page=&size=  -> list
//   GET    ?id=42                            -> one property, with images
//   POST   ?id=42&action=unpublish           -> unpublish; body { reason } (required)
//   DELETE ?id=42&imageId=7                  -> delete one image; body { reason } (optional)

import { requireAdmin } from '../lib/verify-admin.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const BASE_URL = process.env.BACKEND_URL || 'https://production-backend.swap-space.com';
const API_KEY = process.env.AUTO_REGISTER_API_KEY;
const UPSTREAM = `${BASE_URL}/api/internal/admin/properties`;

const isId = (v) => typeof v === 'string' && /^\d+$/.test(v);

// Returns { url, method, body } for the upstream call, or { error } for a bad request.
function buildUpstream(req) {
  const q = req.query || {};

  if (req.method === 'GET') {
    if (q.id != null) {
      if (!isId(q.id)) return { error: 'Invalid id' };
      return { url: `${UPSTREAM}/${q.id}`, method: 'GET' };
    }
    const params = new URLSearchParams();
    if (q.search) params.set('search', String(q.search));
    if (q.published === 'true' || q.published === 'false') params.set('published', q.published);
    params.set('page', isId(q.page) ? q.page : '0');
    params.set('size', isId(q.size) ? q.size : '25');
    return { url: `${UPSTREAM}?${params.toString()}`, method: 'GET' };
  }

  if (!isId(q.id)) return { error: 'Invalid id' };
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;

  if (req.method === 'POST' && q.action === 'unpublish') {
    return { url: `${UPSTREAM}/${q.id}/unpublish`, method: 'POST', body: { reason } };
  }

  if (req.method === 'DELETE') {
    if (!isId(q.imageId)) return { error: 'Invalid imageId' };
    return { url: `${UPSTREAM}/${q.id}/images/${q.imageId}`, method: 'DELETE', body: { reason } };
  }

  return { error: 'Unknown operation' };
}

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAdmin(req, res);
  if (!user) return;

  if (!API_KEY) {
    console.error('AUTO_REGISTER_API_KEY is not set — cannot reach the property admin service.');
    return res.status(500).json({ error: 'Internal API key not configured on the server.' });
  }

  const upstreamReq = buildUpstream(req);
  if (upstreamReq.error) return res.status(400).json({ error: upstreamReq.error });

  try {
    const upstream = await fetch(upstreamReq.url, {
      method: upstreamReq.method,
      headers: {
        Accept: 'application/json',
        'X-Internal-API-Key': API_KEY,
        'X-Admin-Email': user.email,
        ...(upstreamReq.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(upstreamReq.body ? { body: JSON.stringify(upstreamReq.body) } : {}),
    });

    // 401/403 from upstream mean our server-to-server key is wrong, not that the
    // admin's session is. Forwarding them would make adminFetch log the admin
    // out, so report them as 502 (same as /api/email-tracking).
    if (upstream.status === 401 || upstream.status === 403 || upstream.status >= 500) {
      const text = await upstream.text().catch(() => '');
      console.error(`admin-properties upstream ${upstream.status}: ${text.slice(0, 300)}`);
      return res.status(502).json({ error: `Upstream responded ${upstream.status}` });
    }

    // Business errors (400 missing reason, 404 not found, 409 already unpublished)
    // carry a readable { error } message — pass them through for the UI to show.
    const data = await upstream.json().catch(() => ({}));
    return res.status(upstream.status).json(data);
  } catch (err) {
    console.error('admin-properties proxy error:', err);
    return res.status(502).json({ error: 'Failed to reach the property admin service.' });
  }
}
