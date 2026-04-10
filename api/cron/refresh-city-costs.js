/**
 * Weekly CRON: Refresh exchange rates
 *
 * City cost data comes from the Kaggle static dataset (imported once via
 * scripts/import-city-costs.js) — it does NOT need weekly refresh.
 * Only exchange rates need to be kept current.
 *
 * Vercel cron schedule: "0 3 * * 1"  (every Monday at 03:00 UTC)
 *
 * vercel.json entry:
 * "crons": [{ "path": "/api/cron/refresh-city-costs", "schedule": "0 3 * * 1" }]
 */

import https from 'https';
import supabase from '../../lib/supabase.js';

function httpsGetJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGetJSON(res.headers.location).then(resolve).catch(reject);
      }
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

export default async function handler(req, res) {
  // Protect against accidental triggers
  const authHeader = req.headers.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const data  = await httpsGetJSON('https://api.exchangerate-api.com/v4/latest/USD');
    const rates = data.rates || {};

    const { error } = await supabase
      .from('exchange_rates')
      .upsert(
        { id: 1, rates, fetched_at: new Date().toISOString() },
        { onConflict: 'id' }
      );

    if (error) throw new Error('Supabase upsert failed: ' + error.message);

    console.log(`Exchange rates refreshed — ${Object.keys(rates).length} currencies`);

    return res.status(200).json({
      success:       true,
      currencyCount: Object.keys(rates).length,
      refreshedAt:   new Date().toISOString(),
    });

  } catch (err) {
    console.error('refresh-city-costs cron error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
