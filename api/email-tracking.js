// Server-side proxy for the SwapSpace internal email-tracking API.
//
// The upstream is authenticated with a STATIC internal API key, not a user
// login. That key must stay server-side, so the browser never calls upstream
// directly — it calls this endpoint, which attaches `X-Internal-API-Key` and
// forwards the request. Admins authenticate to *this* endpoint with their
// Supabase JWT (Bearer), exactly like /api/admin.
//
// Key + host: the SwapSpace backend guards all its /api/internal/* routes with
// one shared internal key, so we reuse BACKEND_URL + AUTO_REGISTER_API_KEY —
// the same pair /api/admin uses for auto-register and friends.
//
// Routing note: server.js (and Vercel) maps one URL to one file, so rather than
// proxy three upstream paths via sub-routes, we switch on a `resource` query
// param — all of /api/email-tracking[?resource=types|timeline] hit this handler:
//   (default) -> GET /api/internal/email-tracking?emailType=&page=&size=
//   types     -> GET /api/internal/email-tracking/types
//   timeline  -> GET /api/internal/email-tracking/{messageId}

import { createClient } from '@supabase/supabase-js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const BASE_URL = process.env.BACKEND_URL || 'https://production-backend.swap-space.com';
const API_KEY = process.env.AUTO_REGISTER_API_KEY;

// Verify the admin's Bearer JWT with the anon-key client; returns user or null.
// (Mirrors verifyAdmin in /api/admin.js.)
async function verifyAdmin(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const authClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: { user }, error } = await authClient.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

// Translate the incoming request into the upstream URL. Returns null when a
// required parameter is missing (timeline needs a messageId).
function buildUpstreamUrl(query) {
  const resource = query.resource || 'list';

  if (resource === 'types') {
    return `${BASE_URL}/api/internal/email-tracking/types`;
  }

  if (resource === 'timeline') {
    if (!query.messageId) return null;
    return `${BASE_URL}/api/internal/email-tracking/${encodeURIComponent(query.messageId)}`;
  }

  // Default: the paginated, optionally-filtered list.
  const params = new URLSearchParams();
  if (query.emailType) params.set('emailType', query.emailType);
  params.set('page', query.page != null ? String(query.page) : '0');
  params.set('size', query.size != null ? String(query.size) : '50');
  return `${BASE_URL}/api/internal/email-tracking?${params.toString()}`;
}

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Gate on the admin's OWN session. A 401 from this endpoint (and only this
  // endpoint) is what tells the browser helper (adminFetch) to bounce to the
  // login screen — so it must mean "your admin session is invalid", never
  // "the upstream internal key is wrong".
  const user = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (!API_KEY) {
    console.error('AUTO_REGISTER_API_KEY is not set — cannot reach the email-tracking service.');
    return res.status(500).json({ error: 'Internal API key not configured on the server.' });
  }

  const url = buildUpstreamUrl(req.query || {});
  if (!url) return res.status(400).json({ error: 'Missing messageId' });

  try {
    const upstream = await fetch(url, {
      headers: { Accept: 'application/json', 'X-Internal-API-Key': API_KEY },
    });

    if (!upstream.ok) {
      // Upstream failures — crucially including upstream 401 (a bad/missing
      // internal key) — are surfaced as 502 rather than forwarded verbatim. A
      // passed-through 401 would make adminFetch log the admin out, which is
      // misleading: their session is fine; our server-to-server config isn't.
      const body = await upstream.text().catch(() => '');
      console.error(`email-tracking upstream ${upstream.status}: ${body.slice(0, 300)}`);
      return res.status(502).json({ error: `Upstream responded ${upstream.status}` });
    }

    const data = await upstream.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error('email-tracking proxy error:', err);
    return res.status(502).json({ error: 'Failed to reach the email-tracking service.' });
  }
}
