export default async function handler(req, res) {
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
            subject: 'SwapSpace | Your application is complete!',
            html: `
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
              </head>
              <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.7; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
                
                <p style="font-size: 16px;">Hello ${fields.Name || 'there'},</p>
                
                <p>Thanks for sending over your photos, we've received everything, and your application is now fully submitted.</p>
                
                <h2 style="color: #079455; font-size: 18px; margin-top: 30px; margin-bottom: 15px;">What's next</h2>
                
                <p>You don't need to take any action right now. We'll review your home shortly and notify you once it's been accepted. Reviews are done on a rolling basis, focusing first on locations where member interest is highest. This helps us make sure every new member has a great experience when they join.</p>
                
                <h2 style="color: #079455; font-size: 18px; margin-top: 30px; margin-bottom: 15px;">Once your application is approved:</h2>
                
                <p>SwapSpace is a members-only community, so all members list their homes, even if they plan to travel before hosting.</p>
                
                <p>To keep the community safe, identity verification is required before your home can go live. Once completed, you'll see a verified ID badge on your profile.</p>
                
                <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee;">
                  <p style="margin-bottom: 5px;">Thank you for sharing your home with us!</p>
                  <p style="margin-top: 0; font-weight: 500;">We cannot wait to welcome you.</p>
                </div>
                
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

    return res.status(200).json({ success: true, id: data.id });
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
