import crypto from 'crypto';
import supabase from './lib/supabase.js';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const META_PIXEL_ID = process.env.META_PIXEL_ID;
  const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing Supabase environment variables');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const { fields } = req.body;

    if (!fields) {
      return res.status(400).json({ error: 'Missing form fields' });
    }

    // Insert into Supabase (map frontend field names to DB columns)
    const { data, error: insertError } = await supabase
      .from('applications')
      .insert({
        name: fields.Name,
        email: fields.Email,
        phone: fields.Phone,
        address: fields.Address,
        city: fields.City,
        country: fields.Country,
        home_type: fields['Home Type'],
        bedrooms: fields.Bedrooms,
        guest_capacity: fields['Guest Capacity'],
        submission_date: fields['Submission Date'] || new Date().toISOString(),
        application_status: 'Photos Requested',
      })
      .select()
      .single();

    if (insertError) {
      console.error('Supabase insert error:', insertError);
      return res.status(500).json({
        error: insertError.message || 'Failed to submit application'
      });
    }

    // Send confirmation email via Resend
    if (RESEND_API_KEY && fields.Email) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'SwapSpace <hello@notifications.swap-space.com>',
            reply_to: 'hello@swap-space.com',
            to: fields.Email,
            subject: 'Share photos of your home to complete your SwapSpace application',
            html: `
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
              </head>
              <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.7; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">

                <p style="font-size: 16px;">Hi ${fields.Name || 'there'},</p>

                <p>Thank you for applying to join SwapSpace.</p>

                <p>We've received your application successfully. To complete the review process, we just need a few photos of your home. Between 1 and 5 photos is sufficient, and they do not need to be professionally taken.</p>

                <p>Once these have been shared, our team will be able to complete the review.</p>

                <a
  href="https://www.swap-space.com/upload-images.html?recordId=${data.id}"
  style="
    display: inline-flex;
    align-items: center;
    width: fit-content;
    gap: 6px;
    margin-top: 12px;
    padding: 12px 24px;
    background-color: #079455;
    color: #fff;
    font-size: 14px;
    font-weight: 400;
    font-family: 'General Sans', sans-serif;
    text-decoration: none;
    border-radius: 40px;
    cursor: pointer;
    transition: background-color 0.2s ease, transform 0.1s ease;
  "
>
  Submit images
</a>

                <p>We are excited to see the rest of your home. Please let us know if you have any questions!</p>

                <p style="margin-top: 30px;">
                  Warmly,<br>
                  <strong>The SwapSpace Team</strong>
                </p>

                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

                <p style="font-size: 12px; color: #888; text-align: center;">
                  © ${new Date().getFullYear()} SwapSpace. All rights reserved.
                </p>
              </body>
              </html>
            `
          })
        });
        console.log('Confirmation email sent to:', fields.Email);
      } catch (emailError) {
        // Don't fail the whole request if email fails
        console.error('Email error:', emailError);
      }
    }

    // Fire Meta Conversions API (CAPI) Lead Event
    const eventId = `lead_${data.id}_${Date.now()}`;

    if (META_PIXEL_ID && META_ACCESS_TOKEN) {
      try {
        const hashData = (dataStr) => {
          if (!dataStr) return '';
          return crypto
            .createHash('sha256')
            .update(dataStr.trim().toLowerCase())
            .digest('hex');
        };

        const userData = {
          client_ip_address: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
          client_user_agent: req.headers['user-agent'],
        };

        if (fields.Email) userData.em = [hashData(fields.Email)];
        if (fields.Phone) {
          const cleanPhone = fields.Phone.replace(/\D/g, '');
          userData.ph = [hashData(cleanPhone)];
        }
        if (fields.City) userData.ct = [hashData(fields.City)];
        if (fields.Country) userData.country = [hashData(fields.Country)];

        const capiPayload = {
          data: [
            {
              event_name: 'Lead',
              event_time: Math.floor(Date.now() / 1000),
              action_source: 'website',
              event_id: eventId,
              user_data: userData,
              custom_data: {
                home_type: fields['Home Type'],
                bedrooms: fields.Bedrooms,
                guest_capacity: fields['Guest Capacity']
              }
            }
          ]
        };

        const capiResponse = await fetch(
          `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(capiPayload)
          }
        );

        if (!capiResponse.ok) {
          const capiErr = await capiResponse.json();
          console.error('Meta CAPI error:', capiErr);
        } else {
          console.log('Meta CAPI Lead event fired successfully with event_id:', eventId);
        }
      } catch (capiError) {
        console.error('Error sending Meta CAPI event:', capiError);
      }
    } else {
      console.log('Skipping Meta CAPI: META_PIXEL_ID or META_ACCESS_TOKEN missing');
    }

    return res.status(200).json({ success: true, id: data.id, eventId });
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
