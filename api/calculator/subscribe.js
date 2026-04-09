import supabase from '../lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, city, currency, nights, travellers, style } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const { error } = await supabase
    .from('calculator_leads')
    .upsert(
      {
        email:      email.toLowerCase().trim(),
        city:       city || null,
        currency:   currency || null,
        nights:     nights || null,
        travellers: travellers || null,
        style:      style || null,
        source:     'travel-cost-calculator',
        created_at: new Date().toISOString(),
      },
      { onConflict: 'email' }
    );

  if (error) {
    console.error('calculator subscribe error:', error);
    return res.status(500).json({ error: 'Could not save. Please try again.' });
  }

  return res.status(200).json({ success: true });
}
