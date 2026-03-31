import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  // Verify admin auth
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');

  const authClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const { applicationId } = req.body;

    if (!applicationId) {
      return res.status(400).json({ error: 'Missing applicationId' });
    }

    // Fetch the application
    const { data: application, error: fetchError } = await supabase
      .from('applications')
      .select('*')
      .eq('id', applicationId)
      .single();

    if (fetchError || !application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    if (!application.email) {
      return res.status(400).json({ error: 'Application has no email address' });
    }

    // Send photo request email
    if (!RESEND_API_KEY) {
      return res.status(500).json({ error: 'Email service not configured' });
    }

    const name = application.name || 'there';
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.7; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">

  <p style="font-size: 16px;">Hi ${name},</p>

  <p>Thank you for applying to join SwapSpace.</p>

  <p>We've received your application successfully. To complete the review process, we just need a few photos of your home. Between 1 and 5 photos is sufficient, and they do not need to be professionally taken.</p>

  <p>Once these have been shared, our team will be able to complete the review.</p>

  <a
    href="https://www.swap-space.com/upload-images.html?recordId=${application.id}"
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
    SwapSpace Europe LTD<br>
    82a James Carter Road Mildenhall IP28 7DE, United Kingdom<br>
    ©${new Date().getFullYear()} SwapSpace. All rights reserved.
  </p>
</body>
</html>
    `;

    try {
      const emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'SwapSpace <hello@notifications.swap-space.com>',
          reply_to: 'hello@swap-space.com',
          to: application.email,
          subject: 'Share photos of your home to complete your SwapSpace application',
          html: emailHtml
        })
      });

      if (!emailResponse.ok) {
        const emailErr = await emailResponse.json();
        console.error('Resend error:', emailErr);
        return res.status(500).json({ error: 'Failed to send email' });
      }

      console.log(`Photo request email sent to ${application.email}`);
    } catch (emailError) {
      console.error('Email error:', emailError);
      return res.status(500).json({ error: 'Failed to send email' });
    }

    return res.status(200).json({ success: true, applicationId });
  } catch (error) {
    console.error('Resend photos error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
