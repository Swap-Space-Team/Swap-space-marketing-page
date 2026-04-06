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

    const listingReady = fields['Listing Ready'] === 'ready';
    const firstName = (fields.Name || '').split(' ')[0] || 'there';

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
        home_ownership: fields['Home Ownership'] || null,
        listing_ready: fields['Listing Ready'] || null,
        top_cities: fields['Top Cities'] || null,
        travel_dates: fields['Travel Dates'] || null,
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

    // Send confirmation email via Resend — two paths based on listing readiness
    if (RESEND_API_KEY && fields.Email) {
      try {
        const emailPayload = listingReady
          ? {
              subject: 'Application received. Here\'s what to do next',
              html: `
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="utf-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                </head>
                <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.7; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">

                  <p style="font-size: 16px;">Hi ${firstName},</p>

                  <p>You're in! Well, almost. Thank you for applying to SwapSpace. We'll review your application and get back to you within 24 hours.</p>

                  <p>While you wait, there's one small thing you can do to get ahead. Start putting together at least 5 photos of your home. These are the photos you'll use to create your listing once you're approved, so it's worth getting them ready now.</p>

                  <p>Not sure what kinds of photos to take? We've put together a handy guide to help:</p>

                  <a
                    href="https://www.swap-space.com/guides-pages/photoguidelines"
                    style="display: inline-block; margin-top: 4px; margin-bottom: 8px; padding: 12px 24px; background-color: #079455; color: #fff; font-size: 14px; font-weight: 500; text-decoration: none; border-radius: 40px;"
                  >
                    View photo guide →
                  </a>

                  <p>Just a heads up that all approved members need to complete their home listing within 5 days of approval. Getting your photos sorted now means you'll be ready to go the moment you hear from us.</p>

                  <p>We'll be in touch very soon.</p>

                  <p style="margin-top: 30px;">
                    Best,<br>
                    <strong>The SwapSpace team</strong>
                  </p>

                  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                  <p style="font-size: 12px; color: #888; text-align: center;">
                    © ${new Date().getFullYear()} SwapSpace. All rights reserved.
                  </p>
                </body>
                </html>
              `
            }
          : {
              subject: 'We\'ve received your application',
              html: `
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="utf-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                </head>
                <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.7; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">

                  <p style="font-size: 16px;">Hi ${firstName},</p>

                  <p>Thank you for applying to SwapSpace. We review applications on a rolling basis, so we'll be in touch once your application has been accepted.</p>

                  <p>Whenever you're ready to list your home, we'll be here. If you change your mind in the meantime and want to get started sooner, just drop us an email at <a href="mailto:hello@swap-space.com" style="color: #079455;">hello@swap-space.com</a> and we'll take it from there.</p>

                  <p>We'll be in touch soon.</p>

                  <p style="margin-top: 30px;">
                    Best,<br>
                    <strong>The SwapSpace team</strong>
                  </p>

                  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                  <p style="font-size: 12px; color: #888; text-align: center;">
                    © ${new Date().getFullYear()} SwapSpace. All rights reserved.
                  </p>
                </body>
                </html>
              `
            };

        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'SwapSpace <hello@notifications.swap-space.com>',
            reply_to: 'hello@swap-space.com',
            to: fields.Email,
            ...emailPayload
          })
        });
        if (!resendRes.ok) {
          const resendErr = await resendRes.json();
          console.error('Resend API error:', JSON.stringify(resendErr));
        } else {
          console.log(`Confirmation email (${listingReady ? 'ready' : 'not-ready'} path) sent to:`, fields.Email);
        }
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
