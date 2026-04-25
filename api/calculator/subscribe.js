import supabase from '../../lib/supabase.js';

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
  const accom       = breakdown.accommodation || 0;
  const withSwap    = total - accom;
  const accomPct    = Math.round((accom / total) * 100);
  const accomFmt    = formatCurrency(accom, currency);
  const totalFmt    = formatCurrency(total, currency);
  const withSwapFmt = formatCurrency(withSwap, currency);
  const shareLink   = shareUrl || 'https://www.swap-space.com/travel-cost-calculator';

  const otherRows = [
    { label: '🍽️ Food & dining',   value: breakdown.food },
    { label: '☕ Drinks & coffee',  value: breakdown.drinks },
    { label: '🚇 Transport',        value: breakdown.transport },
    { label: '🎭 Entertainment',    value: breakdown.entertainment },
  ];

  const otherRowsHtml = otherRows.map(r => `
    <tr>
      <td style="padding:9px 0;font-size:14px;color:#374151;border-bottom:1px solid #f3f4f6;">${r.label}</td>
      <td style="padding:9px 0;font-size:14px;font-weight:600;color:#111827;text-align:right;border-bottom:1px solid #f3f4f6;">${formatCurrency(r.value || 0, currency)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

        <!-- Header -->
        <tr><td style="background:#043f29;border-radius:16px 16px 0 0;padding:32px 36px;text-align:center;">
          <img src="https://www.swap-space.com/assets/Swapspace-wordmark-white.svg" alt="SwapSpace" width="130" height="27" style="display:block;margin:0 auto 20px;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#fbbf24;">Your ${city} trip estimate</p>
          <p style="margin:0;font-size:14px;color:#86efac;">${styleLabel} &middot; ${nights} night${nights !== 1 ? 's' : ''} &middot; ${travellers} traveller${travellers !== 1 ? 's' : ''}</p>
        </td></tr>

        <!-- Savings hero -->
        <tr><td style="background:#fbbf24;padding:28px 36px;text-align:center;">
          <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#78350f;">You could save</p>
          <p style="margin:0 0 4px;font-size:52px;font-weight:800;letter-spacing:-2px;color:#1c1917;line-height:1;">${accomFmt}</p>
          <p style="margin:0;font-size:14px;color:#92400e;">on this trip — that's ${accomPct}% of your budget gone, just for a hotel room.</p>
        </td></tr>

        <!-- Comparison block -->
        <tr><td style="background:#ffffff;padding:28px 36px 20px;">
          <p style="margin:0 0 16px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;">See the difference</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <!-- Standard -->
              <td width="45%" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px 14px;text-align:center;vertical-align:top;">
                <p style="margin:0 0 6px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:#9ca3af;">Standard trip</p>
                <p style="margin:0 0 4px;font-size:26px;font-weight:700;letter-spacing:-0.8px;color:#9ca3af;text-decoration:line-through;">${totalFmt}</p>
                <p style="margin:0;font-size:11px;color:#9ca3af;">Hotel included</p>
              </td>
              <!-- Arrow -->
              <td width="10%" style="text-align:center;vertical-align:middle;color:#d1d5db;font-size:18px;">&rarr;</td>
              <!-- SwapSpace -->
              <td width="45%" style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:10px;padding:16px 14px;text-align:center;vertical-align:top;">
                <p style="margin:0 0 6px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:#15803d;">With SwapSpace</p>
                <p style="margin:0 0 4px;font-size:30px;font-weight:800;letter-spacing:-1px;color:#14532d;">${withSwapFmt}</p>
                <p style="margin:0;font-size:11px;color:#16a34a;">Accommodation: free</p>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Accommodation callout -->
        <tr><td style="background:#ffffff;padding:0 36px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size:14px;color:#92400e;">🏨 Accommodation</td>
                    <td style="font-size:14px;font-weight:700;color:#92400e;text-align:right;">${accomFmt}</td>
                  </tr>
                  <tr>
                    <td colspan="2" style="padding-top:6px;font-size:12px;color:#b45309;">
                      <span style="display:inline-block;background:#fbbf24;color:#1c1917;font-size:11px;font-weight:700;border-radius:99px;padding:2px 10px;">SwapSpace removes this cost entirely</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Other costs breakdown -->
        <tr><td style="background:#ffffff;padding:0 36px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td colspan="2" style="padding-bottom:10px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;">What you still pay for</td></tr>
            ${otherRowsHtml}
          </table>
        </td></tr>

        <!-- Primary CTA -->
        <tr><td style="background:#043f29;padding:32px 36px;text-align:center;">
          <p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#ffffff;line-height:1.3;">Stay in a real ${city} home.<br>Pay nothing for the room.</p>
          <p style="margin:0 0 24px;font-size:14px;color:#86efac;line-height:1.6;">SwapSpace connects homeowners who travel. You host someone at yours, they host you at theirs. No fees. No awkward transactions. Just free accommodation.</p>
          <a href="https://www.swap-space.com/application.html" style="display:inline-block;background:#fbbf24;color:#1c1917;font-size:15px;font-weight:700;padding:14px 32px;border-radius:99px;text-decoration:none;letter-spacing:-0.2px;">List my home &amp; find free stays &rarr;</a>
          <p style="margin:16px 0 0;font-size:12px;color:#6ee7b7;">Free to join &middot; Verified members only &middot; You control your availability</p>
        </td></tr>

        <!-- How it works -->
        <tr><td style="background:#f9fafb;padding:28px 36px;">
          <p style="margin:0 0 16px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;">How it works</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding-bottom:12px;vertical-align:top;">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:28px;height:28px;background:#043f29;border-radius:50%;text-align:center;vertical-align:middle;font-size:13px;font-weight:700;color:#fff;">1</td>
                    <td style="padding-left:12px;font-size:14px;color:#374151;">List your home and tell us when you're available</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:12px;vertical-align:top;">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:28px;height:28px;background:#043f29;border-radius:50%;text-align:center;vertical-align:middle;font-size:13px;font-weight:700;color:#fff;">2</td>
                    <td style="padding-left:12px;font-size:14px;color:#374151;">Browse verified member homes in ${city}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="vertical-align:top;">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:28px;height:28px;background:#043f29;border-radius:50%;text-align:center;vertical-align:middle;font-size:13px;font-weight:700;color:#fff;">3</td>
                    <td style="padding-left:12px;font-size:14px;color:#374151;">Agree on dates and travel — accommodation sorted, for free</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Share link -->
        <tr><td style="background:#ffffff;border-radius:0 0 16px 16px;padding:20px 36px 28px;text-align:center;">
          <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">Share this estimate with your travel companions:</p>
          <a href="${shareLink}" style="display:inline-block;background:#f9fafb;border:1.5px solid #e5e7eb;border-radius:8px;padding:9px 18px;font-size:13px;color:#043f29;font-weight:500;text-decoration:none;word-break:break-all;">${shareLink}</a>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 0;text-align:center;">
          <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;">Estimates based on Numbeo crowd-sourced data. Actual costs vary by season and availability.</p>
          <p style="margin:0;font-size:12px;color:#9ca3af;"><a href="https://www.swap-space.com" style="color:#6b7280;text-decoration:none;">swap-space.com</a></p>
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
        subject: `You could save ${new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(breakdown.accommodation || 0)} on your ${city} trip`,
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
