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

  const BACKEND_URL = process.env.BACKEND_URL;
  const AUTO_REGISTER_API_KEY = process.env.AUTO_REGISTER_API_KEY;

  // Verify admin auth
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');

  // Use anon key client to verify the JWT (not service role)
  const authClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Use service role client for DB operations
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

    // Update status to Approved and mark email as sent
    const { error: updateError } = await supabase
      .from('applications')
      .update({
        application_status: 'Approved',
        approval_email_sent: true,
      })
      .eq('id', applicationId);

    if (updateError) {
      console.error('Failed to update application status:', updateError);
      return res.status(500).json({ error: 'Failed to update application status' });
    }

    // Call external backend to auto-register the approved applicant
    if (BACKEND_URL && AUTO_REGISTER_API_KEY) {
      try {
        const registerResponse = await fetch(`${BACKEND_URL}/api/internal/auto-register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-API-Key': AUTO_REGISTER_API_KEY,
          },
          body: JSON.stringify({
            email: application.email,
            name: application.name,
            telephone: application.phone,
          }),
        });

        if (!registerResponse.ok) {
          const registerErr = await registerResponse.json().catch(() => ({}));
          console.error('Auto-register failed:', registerErr);
          return res.status(200).json({
            success: true,
            warning: 'Application approved but failed to register user on the platform. Please register them manually.',
          });
        }

        console.log(`Auto-register succeeded for ${application.email}`);
      } catch (registerError) {
        console.error('Auto-register error:', registerError);
        return res.status(200).json({
          success: true,
          warning: 'Application approved but could not reach the platform to register the user. Please register them manually.',
        });
      }
    } else {
      console.warn('BACKEND_URL or AUTO_REGISTER_API_KEY not set — skipping auto-register');
    }

    return res.status(200).json({ success: true, applicationId });
  } catch (error) {
    console.error('Approve error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
