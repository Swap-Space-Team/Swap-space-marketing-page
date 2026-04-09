import supabase from '../lib/supabase.js';

const FROM = 'SwapSpace <hello@notifications.swap-space.com>';

function formatCurrency(amount, currency) {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(amount);
  } catch (_) {
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
}

function buildEmailHtml({ email, city, styleLabel, nights, travellers, total, breakdown, currency, perPersonPerDay, shareUrl }) {
  const rows = [
    { label: '🏨 Accommodation', value: breakdown.accommodation },
    { label: '🍽️ Food & dining',  value: breakdown.food },
    { label: '☕ Drinks & coffee', value: breakdown.drinks },
    { label: '🚇 Transport',       value: breakdown.transport },
    { label: '🎭 Entertainment',   value: breakdown.entertainment },
  ];

  const rowsHtml = rows.map(r => `
    <tr>
      <td style="padding:10px 0; font-size:15px; color:#374151; border-bottom:1px solid #f3f4f6;">${r.label}</td>
      <td style="padding:10px 0; font-size:15px; font-weight:600; color:#111827; text-align:right; border-bottom:1px solid #f3f4f6;">${formatCurrency(r.value || 0, currency)}</td>
    </tr>`).join('');

  const accomSaving = formatCurrency(breakdown.accommodation || 0, currency);
  const shareLink  = shareUrl || 'https://www.swap-space.com/travel-cost-calculator';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

        <!-- Header -->
        <tr><td style="background:#1a3c2b;border-radius:16px 16px 0 0;padding:32px 36px;text-align:center;">
          <img src="https://www.swap-space.com/assets/Swapspace-wordmark-white.svg" alt="SwapSpace" width="130" height="27" style="display:block;margin:0 auto 20px;">
          <p style="margin:0 0 6px;font-size:13px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#fbbf24;">Your trip estimate</p>
          <h1 style="margin:0;font-size:26px;font-weight:700;color:#ffffff;line-height:1.2;">${city}</h1>
          <p style="margin:8px 0 0;font-size:14px;color:#86efac;">${styleLabel} style &middot; ${nights} night${nights !== 1 ? 's' : ''} &middot; ${travellers} traveller${travellers !== 1 ? 's' : ''}</p>
        </td></tr>

        <!-- Total -->
        <tr><td style="background:#fff;padding:28px 36px 20px;text-align:center;">
          <p style="margin:0 0 4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;">Estimated total</p>
          <p style="margin:0 0 6px;font-size:48px;font-weight:700;letter-spacing:-2px;color:#1a3c2b;">${formatCurrency(total, currency)}</p>
          <span style="display:inline-block;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:99px;padding:4px 14px;font-size:13px;font-weight:500;color:#15803d;">≈ ${formatCurrency(perPersonPerDay, currency)} per person, per day</span>
        </td></tr>

        <!-- Breakdown -->
        <tr><td style="background:#fff;padding:0 36px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td colspan="2" style="padding-bottom:12px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;">Cost breakdown</td></tr>
            ${rowsHtml}
          </table>
        </td></tr>

        <!-- SwapSpace CTA -->
        <tr><td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:0;padding:24px 36px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#1a3c2b;">What if accommodation was free?</p>
                <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#166534;">SwapSpace members save ${accomSaving} on this trip by swapping homes with verified members at their destination — no fees, no hotels.</p>
                <a href="https://www.swap-space.com/application.html" style="display:inline-block;background:#1a3c2b;color:#fff;font-size:14px;font-weight:600;padding:12px 24px;border-radius:99px;text-decoration:none;">See if I can swap my home &rarr;</a>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Share link -->
        <tr><td style="background:#fff;border-radius:0 0 16px 16px;padding:20px 36px 28px;text-align:center;">
          <p style="margin:0 0 10px;font-size:13px;color:#6b7280;">Share this estimate with your travel companions:</p>
          <a href="${shareLink}" style="display:inline-block;background:#f9fafb;border:1.5px solid #e5e7eb;border-radius:8px;padding:9px 18px;font-size:13px;color:#1a3c2b;font-weight:500;text-decoration:none;word-break:break-all;">${shareLink}</a>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 0;text-align:center;">
          <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;">Estimates based on Numbeo crowd-sourced data. Actual costs vary by season and availability.</p>
          <p style="margin:0;font-size:12px;color:#9ca3af;">
            <a href="https://www.swap-space.com" style="color:#6b7280;text-decoration:none;">swap-space.com</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, city, currency, nights, travellers, style, styleLabel, total, breakdown, perPersonPerDay, shareUrl } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  // Save lead to Supabase
  const { error: dbError } = await supabase
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

  if (dbError) {
    console.error('calculator subscribe error:', dbError);
    // Don't block email sending if DB save fails
  }

  // Send results email via Resend (non-blocking — don't fail the request if email fails)
  if (total && breakdown && city) {
    const html = buildEmailHtml({
      email, city,
      styleLabel: styleLabel || style || 'Mid-range',
      nights: nights || 7,
      travellers: travellers || 2,
      total, breakdown, currency: currency || 'USD',
      perPersonPerDay: perPersonPerDay || Math.round(total / Math.max(nights || 1, 1) / Math.max(travellers || 1, 1)),
      shareUrl,
    });

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        subject: `Your ${city} trip estimate — ${new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(total)}`,
        html,
      }),
    }).catch(err => {
      console.error('Resend fetch error:', err);
      return null;
    });

    if (resendRes && !resendRes.ok) {
      const body = await resendRes.json().catch(() => ({}));
      console.error('Resend API error:', JSON.stringify(body));
    }
  }

  return res.status(200).json({ success: true });
}
