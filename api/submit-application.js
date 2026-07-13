import crypto from 'crypto';
import supabase from '../lib/supabase.js';
import { isAutoApprovable, regionForCountry } from '../lib/regions.js';
import { autoRegisterUser } from '../lib/auto-register.js';

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
  const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

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

    // ── Geographic auto-approval gate ──────────────────────────────────────────
    // Feature-flagged kill switch. When off, behaviour is identical to the legacy
    // manual-review flow. When on, applicants from allowed regions are approved and
    // registered on the platform at submission time.
    const AUTO_APPROVAL_ENABLED = process.env.AUTO_APPROVAL_ENABLED === 'true';
    const countryCode = fields.CountryCode || null;
    const region = regionForCountry(countryCode);
    // Whether we intend to auto-approve. Only actually confirmed once the account
    // is successfully created on the platform (see the auto-register step below).
    const wantAutoApprove = AUTO_APPROVAL_ENABLED && isAutoApprovable(countryCode);

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
        country_code: countryCode,
        region,
        home_type: fields['Home Type'],
        bedrooms: fields.Bedrooms,
        guest_capacity: fields['Guest Capacity'],
        home_ownership: fields['Home Ownership'] || null,
        listing_ready: fields['Listing Ready'] || null,
        top_cities: fields['Top Cities'] || null,
        travel_dates: fields['Travel Dates'] || null,
        sms_consent: fields['SMS Consent'] === true,
        sms_consent_at: fields['SMS Consent'] === true ? new Date().toISOString() : null,
        submission_date: fields['Submission Date'] || new Date().toISOString(),
        application_status: wantAutoApprove ? 'Approved' : 'Application Received',
        auto_approved: wantAutoApprove,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Supabase insert error:', insertError);
      return res.status(500).json({
        error: insertError.message || 'Failed to submit application'
      });
    }

    // ── Auto-register the approved applicant on the platform ───────────────────
    // The backend creates the account and sends the password-setup / welcome email.
    // `preApproved` is only true once that succeeds — a failure downgrades the
    // applicant back into the manual pile so we never promise an account we didn't
    // create. This decides which confirmation emails and success screen they get.
    let preApproved = false;
    if (wantAutoApprove) {
      const register = await autoRegisterUser({
        email: fields.Email,
        name: fields.Name,
        telephone: fields.Phone,
      });

      if (register.ok) {
        preApproved = true;
        console.log(`Auto-approved and registered ${fields.Email} (${region})`);
      } else {
        // Fallback: revert to the manual review pile.
        const reason = register.notConfigured
          ? 'backend not configured'
          : register.timedOut
            ? 'timed out'
            : JSON.stringify(register.error || register.status);
        console.error(`Auto-register failed for ${fields.Email} (${reason}) — downgrading to manual review`);
        const { error: downgradeError } = await supabase
          .from('applications')
          .update({ application_status: 'Application Received', auto_approved: false })
          .eq('id', data.id);
        if (downgradeError) {
          console.error('Failed to downgrade auto-approval:', downgradeError);
        }
      }
    }

    // Best-effort Slack notification (never blocks submission)
    if (!SLACK_WEBHOOK_URL) {
      console.warn('SLACK_WEBHOOK_URL not set; skipping Slack notification');
    } else {
      try {
        const submittedAt =
          data?.submission_date ||
          fields['Submission Date'] ||
          new Date().toISOString();

        const city = fields.City || '';
        const country = fields.Country || '';
        const location =
          city && country ? `${city}, ${country}` : (city || country || 'N/A');

        const readyToListLabel = listingReady ? 'Yes' : 'No';

        const slackText = [
          preApproved ? 'New application submitted (auto-approved)' : 'New application submitted',
          `Name: ${fields.Name || 'N/A'}`,
          `Email: ${fields.Email || 'N/A'}`,
          `Location: ${location}`,
          `Region: ${region}`,
          `Pre-approved: ${preApproved ? 'Yes' : 'No'}`,
          `Ready to list: ${readyToListLabel}`,
          `Submitted: ${submittedAt}`,
        ].join('\n');

        const slackRes = await fetch(SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: slackText }),
        });

        if (!slackRes.ok) {
          const slackBody = await slackRes.text().catch(() => '');
          console.error('Slack webhook error:', slackRes.status, slackBody);
        }
      } catch (slackError) {
        console.error('Slack notification error:', slackError);
      }
    }

    // Send confirmation email via Resend — two paths based on listing readiness.
    // Skipped for pre-approved applicants: the platform sends their password-setup /
    // welcome email, and the "we'll review" wording would be wrong for them.
    if (!preApproved && RESEND_API_KEY && fields.Email) {
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

    // Schedule two follow-up emails via Resend's scheduled send.
    // Email 1 goes out 2 hours after submission, Email 2 goes out 20 hours after.
    // Best-effort: never blocks or fails the submission.
    // Skipped for pre-approved applicants — these nudge toward a pending decision
    // that has already been made.
    if (!preApproved && RESEND_API_KEY && fields.Email) {
      const followUps = [
        {
          label: 'follow-up-2h',
          scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          subject: 'A quick tip regarding your SwapSpace application',
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.7; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">

              <p style="font-size: 16px;">Hi ${firstName},</p>

              <p>Thank you for applying to join SwapSpace.</p>

              <p>Our team is currently reviewing your application and we'll be in touch soon.</p>

              <p>In the meantime, it's worth starting to gather a few photos of your home for your listing. Around 5 photos is a great place to start and will help you get set up more quickly once you're approved.</p>

              <p>There's no need for professional photography or extensive preparation. We simply want to help other members get a sense of your space.</p>

              <p style="margin-top: 30px;">
                Warm regards,<br>
                <strong>The SwapSpace Team</strong>
              </p>

              <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
              <p style="font-size: 12px; color: #888; text-align: center;">
                © ${new Date().getFullYear()} SwapSpace. All rights reserved.
              </p>
            </body>
            </html>
          `
        },
        {
          label: 'follow-up-20h',
          scheduledAt: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(),
          subject: 'Your application decision is coming soon',
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.7; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">

              <p style="font-size: 16px;">Hi ${firstName},</p>

              <p>Just a quick update. We'll be sending a decision on your SwapSpace application in around 2 hours.</p>

              <p>In the meantime, it might be worth gathering a few photos of your home so you're ready to create your listing if approved.</p>

              <p>We recommend having at least 5 photos ready, including:</p>

              <ul style="margin: 0 0 16px; padding-left: 20px;">
                <li>A living area</li>
                <li>A bedroom</li>
                <li>The kitchen</li>
                <li>A bathroom</li>
                <li>An additional room or outdoor space</li>
              </ul>

              <p>Don't worry about making everything perfect. Clear, well-lit photos taken on your phone are absolutely fine.</p>

              <p>We'll be back in touch shortly.</p>

              <p style="margin-top: 30px;">
                Warm regards,<br>
                <strong>The SwapSpace Team</strong>
              </p>

              <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
              <p style="font-size: 12px; color: #888; text-align: center;">
                © ${new Date().getFullYear()} SwapSpace. All rights reserved.
              </p>
            </body>
            </html>
          `
        }
      ];

      await Promise.all(followUps.map(async ({ label, scheduledAt, subject, html }) => {
        try {
          const scheduledRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${RESEND_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: 'SwapSpace <hello@notifications.swap-space.com>',
              reply_to: 'hello@swap-space.com',
              to: fields.Email,
              scheduled_at: scheduledAt,
              subject,
              html
            })
          });
          if (!scheduledRes.ok) {
            const scheduledErr = await scheduledRes.json();
            console.error(`Resend scheduled email error (${label}):`, JSON.stringify(scheduledErr));
          } else {
            console.log(`Scheduled email (${label}) queued for ${scheduledAt} to:`, fields.Email);
          }
        } catch (scheduledError) {
          console.error(`Scheduled email error (${label}):`, scheduledError);
        }
      }));
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

    return res.status(200).json({ success: true, id: data.id, eventId, preApproved, region });
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
