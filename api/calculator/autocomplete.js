import supabase from '../../lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Normalise query the same way the import script normalises city_query
  const q = (req.query.q || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  if (q.length < 2) return res.status(200).json([]);

  // Starts-with search on the normalised city_query column — fast and relevant
  const { data, error } = await supabase
    .from('city_costs')
    .select('city_name, country')
    .ilike('city_query', `${q}%`)
    .order('city_name')
    .limit(8);

  if (error) {
    console.error('Autocomplete error:', error);
    return res.status(500).json({ error: 'Search failed' });
  }

  return res.status(200).json(
    (data || []).map(r => ({ name: r.city_name, country: r.country || '' }))
  );
}
