import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify admin auth
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  const authClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { applicationId } = req.body;
    if (!applicationId) return res.status(400).json({ error: 'Missing applicationId' });

    const { data: application, error: fetchError } = await supabase
      .from('applications')
      .select('id, application_status')
      .eq('id', applicationId)
      .single();

    if (fetchError || !application) return res.status(404).json({ error: 'Application not found' });
    if (application.application_status === 'Approved') {
      return res.status(400).json({ error: 'Cannot reject an already approved application' });
    }

    const { error: updateError } = await supabase
      .from('applications')
      .update({ application_status: 'Rejected' })
      .eq('id', applicationId);

    if (updateError) {
      console.error('Failed to reject application:', updateError);
      return res.status(500).json({ error: 'Failed to update application status' });
    }

    return res.status(200).json({ success: true, applicationId });
  } catch (error) {
    console.error('Reject error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
