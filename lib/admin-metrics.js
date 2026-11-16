// Server-side proxy for the SwapSpace backend's key-metrics API
// (/api/internal/admin/metrics). Served by /api/admin?resource=metrics rather
// than its own file: the Vercel Hobby plan caps a deployment at 12 serverless
// functions. /api/admin has already checked the admin (requireAdmin) by the
// time this runs; this adds the internal API key, which never leaves the server.
//
// Read-only. The backend caches the numbers for 5 minutes, so refreshing the
// dashboard doesn't add database load.

const BASE_URL = process.env.BACKEND_URL || 'https://production-backend.swap-space.com';
const API_KEY = process.env.AUTO_REGISTER_API_KEY;
const UPSTREAM = `${BASE_URL}/api/internal/admin/metrics`;

export async function handleAdminMetrics(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!API_KEY) {
    console.error('AUTO_REGISTER_API_KEY is not set — cannot reach the metrics service.');
    return res.status(500).json({ error: 'Internal API key not configured on the server.' });
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      headers: { Accept: 'application/json', 'X-Internal-API-Key': API_KEY },
    });

    // 401/403 from upstream mean our server-to-server key is wrong, not that the
    // admin's session is. Forwarding them would make adminFetch log the admin
    // out, so report every upstream failure as 502 (same as admin-properties).
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      console.error(`admin-metrics upstream ${upstream.status}: ${text.slice(0, 300)}`);
      return res.status(502).json({ error: `Upstream responded ${upstream.status}` });
    }

    const data = await upstream.json();
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json(data);
  } catch (err) {
    console.error('admin-metrics proxy error:', err);
    return res.status(502).json({ error: 'Failed to reach the metrics service.' });
  }
}
