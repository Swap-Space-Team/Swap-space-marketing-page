// Server-side proxy for the public SwapSpace property catalogue.
//
// The upstream backend rejects cross-origin *browser* requests (returns 403),
// even though server-side requests succeed. Proxying here lets admin tools fetch
// the catalogue same-origin — works in local dev (via server.js) and on Vercel —
// without depending on the upstream's CORS/origin rules.

const UPSTREAM = 'https://production-backend.swap-space.com/api/v1/properties/public';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const upstream = await fetch(UPSTREAM, { headers: { Accept: 'application/json' } });
    if (!upstream.ok) {
      return res.status(502).json({ error: `Upstream responded ${upstream.status}` });
    }
    const data = await upstream.json();
    // Cache at the edge for 5 min; the catalogue changes slowly.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch (err) {
    console.error('properties proxy error:', err);
    return res.status(502).json({ error: 'Failed to fetch properties' });
  }
}
