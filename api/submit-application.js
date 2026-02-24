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

  // Get environment variables (set in Vercel dashboard)
  const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;
  const TABLE_ID = process.env.AIRTABLE_TABLE_ID;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!AIRTABLE_TOKEN || !BASE_ID || !TABLE_ID) {
    console.error('Missing Airtable environment variables');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const { fields } = req.body;

    if (!fields) {
      return res.status(400).json({ error: 'Missing form fields' });
    }

    // Forward the request to Airtable
    const airtableResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields })
      }
    );

    const data = await airtableResponse.json();

    if (!airtableResponse.ok) {
      console.error('Airtable error:', data);
      return res.status(airtableResponse.status).json({
        error: data.error?.message || 'Failed to submit to Airtable'
      });
    }

    // Send confirmation email via Resend
    // if (RESEND_API_KEY && fields.Email) {
    //   try {
    //     await fetch('https://api.resend.com/emails', {
    //       method: 'POST',
    //       headers: {
    //         'Authorization': `Bearer ${RESEND_API_KEY}`,
    //         'Content-Type': 'application/json'
    //       },
    //       body: JSON.stringify({
    //         from: 'SwapSpace <hello@notifications.swap-space.com>',
    //         reply_to: 'hello@swap-space.com',
    //         to: fields.Email,
    //         subject: 'SwapSpace | Your application is complete!',
    //         html: `
    //           <!DOCTYPE html>
    //           <html>
    //           <head>
    //             <meta charset="utf-8">
    //             <meta name="viewport" content="width=device-width, initial-scale=1.0">
    //           </head>
    //           <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.7; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
                
    //             <p style="font-size: 16px;">Hi ${fields.Name || 'there'},</p>
                
    //             <p>Thank you for applying to join SwapSpace.</p>

    //             <p>We've received your application successfully. To complete the review process, we just need a few photos of your home. Between 1 and 5 photos is sufficient, and they do not need to be professionally taken.</p>

    //             <p>Once these have been shared, our team will be able to complete the review.</p>

    //             <p>You can respond to this email with a few photos of your home and our team will take a look.</p>

    //             <p>We are excited to see the rest of your home. Please let us know if you have any questions!</p>
                
    //             <p style="margin-top: 30px;">
    //               Warmly,<br>
    //               <strong>The SwapSpace Team</strong>
    //             </p>
                
    //             <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                
    //             <p style="font-size: 12px; color: #888; text-align: center;">
    //               © ${new Date().getFullYear()} SwapSpace. All rights reserved.
    //             </p>
    //           </body>
    //           </html>
    //         `
    //       })
    //     });
    //     console.log('Confirmation email sent to:', fields.Email);
    //   } catch (emailError) {
    //     // Don't fail the whole request if email fails
    //     console.error('Email error:', emailError);
    //   }
    // }

    return res.status(200).json({ success: true, id: data.id });
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
