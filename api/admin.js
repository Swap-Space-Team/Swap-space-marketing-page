import { createClient } from '@supabase/supabase-js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ── Auth helper ───────────────────────────────────────────────────────────────
// Verifies the Bearer JWT using the anon key client; returns the user or null.
async function verifyAdmin(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const authClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: { user }, error } = await authClient.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

// ── Service-role Supabase client ──────────────────────────────────────────────
function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// ── Action handlers ───────────────────────────────────────────────────────────

async function approve(req, res) {
  const supabase = getSupabase();
  const { applicationId } = req.body;
  if (!applicationId) return res.status(400).json({ error: 'Missing applicationId' });

  const { data: application, error: fetchError } = await supabase
    .from('applications').select('*').eq('id', applicationId).single();
  if (fetchError || !application) return res.status(404).json({ error: 'Application not found' });
  if (!application.email) return res.status(400).json({ error: 'Application has no email address' });

  const { error: updateError } = await supabase
    .from('applications')
    .update({ application_status: 'Approved', approval_email_sent: true })
    .eq('id', applicationId);
  if (updateError) {
    console.error('Failed to update application status:', updateError);
    return res.status(500).json({ error: 'Failed to update application status' });
  }

  const BACKEND_URL = process.env.BACKEND_URL;
  const AUTO_REGISTER_API_KEY = process.env.AUTO_REGISTER_API_KEY;
  if (BACKEND_URL && AUTO_REGISTER_API_KEY) {
    try {
      const registerResponse = await fetch(`${BACKEND_URL}/api/internal/auto-register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': AUTO_REGISTER_API_KEY },
        body: JSON.stringify({ email: application.email, name: application.name, telephone: application.phone }),
      });
      if (!registerResponse.ok) {
        const registerErr = await registerResponse.json().catch(() => ({}));
        console.error('Auto-register failed:', registerErr);
        return res.status(200).json({ success: true, warning: 'Application approved but failed to register user on the platform. Please register them manually.' });
      }
      console.log(`Auto-register succeeded for ${application.email}`);
    } catch (registerError) {
      console.error('Auto-register error:', registerError);
      return res.status(200).json({ success: true, warning: 'Application approved but could not reach the platform to register the user. Please register them manually.' });
    }
  } else {
    console.warn('BACKEND_URL or AUTO_REGISTER_API_KEY not set — skipping auto-register');
  }

  return res.status(200).json({ success: true, applicationId });
}

async function reject(req, res) {
  const supabase = getSupabase();
  const { applicationId } = req.body;
  if (!applicationId) return res.status(400).json({ error: 'Missing applicationId' });

  const { data: application, error: fetchError } = await supabase
    .from('applications').select('id, application_status').eq('id', applicationId).single();
  if (fetchError || !application) return res.status(404).json({ error: 'Application not found' });
  if (application.application_status === 'Approved') {
    return res.status(400).json({ error: 'Cannot reject an already approved application' });
  }

  const { error: updateError } = await supabase
    .from('applications').update({ application_status: 'Rejected' }).eq('id', applicationId);
  if (updateError) {
    console.error('Failed to reject application:', updateError);
    return res.status(500).json({ error: 'Failed to update application status' });
  }

  return res.status(200).json({ success: true, applicationId });
}

async function resendPhotos(req, res) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return res.status(500).json({ error: 'Email service not configured' });

  const supabase = getSupabase();
  const { applicationId } = req.body;
  if (!applicationId) return res.status(400).json({ error: 'Missing applicationId' });

  const { data: application, error: fetchError } = await supabase
    .from('applications').select('*').eq('id', applicationId).single();
  if (fetchError || !application) return res.status(404).json({ error: 'Application not found' });
  if (!application.email) return res.status(400).json({ error: 'Application has no email address' });

  const name = application.name || 'there';
  const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.7; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <p style="font-size: 16px;">Hi ${name},</p>
  <p>Thank you for applying to join SwapSpace.</p>
  <p>We've received your application successfully. To complete the review process, we just need a few photos of your home. Between 1 and 5 photos is sufficient, and they do not need to be professionally taken.</p>
  <p>Once these have been shared, our team will be able to complete the review.</p>
  <a href="https://www.swap-space.com/upload-images.html?recordId=${application.id}" style="display:inline-flex;align-items:center;width:fit-content;gap:6px;margin-top:12px;padding:12px 24px;background-color:#079455;color:#fff;font-size:14px;font-weight:400;font-family:'General Sans',sans-serif;text-decoration:none;border-radius:40px;">Submit images</a>
  <p>We are excited to see the rest of your home. Please let us know if you have any questions!</p>
  <p style="margin-top: 30px;">Warmly,<br><strong>The SwapSpace Team</strong></p>
  <hr style="border:none;border-top:1px solid #eee;margin:30px 0;">
  <p style="font-size:12px;color:#888;text-align:center;">SwapSpace Europe LTD<br>82a James Carter Road Mildenhall IP28 7DE, United Kingdom<br>©${new Date().getFullYear()} SwapSpace. All rights reserved.</p>
</body>
</html>`;

  try {
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'SwapSpace <hello@notifications.swap-space.com>',
        reply_to: 'hello@swap-space.com',
        to: application.email,
        subject: 'Share photos of your home to complete your SwapSpace application',
        html: emailHtml,
      }),
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
}

async function deleteApplication(req, res) {
  const supabase = getSupabase();
  const { applicationId } = req.body;
  if (!applicationId) return res.status(400).json({ error: 'Missing applicationId' });

  const { data: photos } = await supabase
    .from('application_photos').select('storage_path').eq('application_id', applicationId);

  if (photos && photos.length > 0) {
    const paths = photos.map(p => p.storage_path);
    const { error: storageError } = await supabase.storage.from('application-photos').remove(paths);
    if (storageError) console.error('[delete-application] Storage delete error:', storageError.message);
  }

  const { error: dbError } = await supabase.from('applications').delete().eq('id', applicationId);
  if (dbError) return res.status(500).json({ error: dbError.message });

  return res.status(200).json({ success: true });
}

async function deletePhoto(req, res) {
  const supabase = getSupabase();
  const { photoId, storagePath } = req.body;
  if (!photoId || !storagePath) return res.status(400).json({ error: 'Missing photoId or storagePath' });

  const { error: storageError } = await supabase.storage.from('application-photos').remove([storagePath]);
  if (storageError) console.error('[delete-photo] Storage delete error:', storageError.message);

  const { error: dbError } = await supabase.from('application_photos').delete().eq('id', photoId);
  if (dbError) return res.status(500).json({ error: dbError.message });

  return res.status(200).json({ success: true });
}

async function calculatorLeads(req, res) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('calculator_leads')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('calculator-leads fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch calculator leads' });
  }
  return res.status(200).json(data || []);
}

// ── Router ────────────────────────────────────────────────────────────────────
async function checkPasswordStatus(req, res) {
  const { emails } = req.body;
  if (!Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ error: 'Missing or empty emails array' });
  }

  const BACKEND_URL = process.env.BACKEND_URL;
  const AUTO_REGISTER_API_KEY = process.env.AUTO_REGISTER_API_KEY;
  if (!BACKEND_URL || !AUTO_REGISTER_API_KEY) {
    return res.status(500).json({ error: 'Backend not configured' });
  }

  let results;
  try {
    const backendRes = await fetch(`${BACKEND_URL}/api/internal/password-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': AUTO_REGISTER_API_KEY },
      body: JSON.stringify(emails),
    });
    if (!backendRes.ok) {
      const err = await backendRes.json().catch(() => ({}));
      console.error('password-status backend error:', err);
      return res.status(502).json({ error: 'Backend request failed' });
    }
    results = await backendRes.json();
  } catch (err) {
    console.error('password-status fetch error:', err);
    return res.status(502).json({ error: 'Could not reach backend' });
  }

  // Update status to "Completed" for users who have set their password
  const completedEmails = results.filter(r => r.passwordChanged === true).map(r => r.email);
  if (completedEmails.length > 0) {
    const supabase = getSupabase();
    const { error: updateError } = await supabase
      .from('applications')
      .update({ application_status: 'Completed' })
      .in('email', completedEmails)
      .eq('application_status', 'Approved');
    if (updateError) {
      console.error('Failed to update completed statuses:', updateError);
      // Non-fatal — still return results to the frontend
    }
  }

  return res.status(200).json({ results, completedCount: completedEmails.length });
}

async function resendWelcomeEmail(req, res) {
  const { emails } = req.body;
  if (!Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ error: 'Missing or empty emails array' });
  }

  const BACKEND_URL = process.env.BACKEND_URL;
  const AUTO_REGISTER_API_KEY = process.env.AUTO_REGISTER_API_KEY;
  if (!BACKEND_URL || !AUTO_REGISTER_API_KEY) {
    return res.status(500).json({ error: 'Backend not configured' });
  }

  try {
    const backendRes = await fetch(`${BACKEND_URL}/api/internal/resend-welcome-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': AUTO_REGISTER_API_KEY },
      body: JSON.stringify(emails),
    });
    if (!backendRes.ok) {
      const err = await backendRes.json().catch(() => ({}));
      console.error('resend-welcome-email backend error:', err);
      return res.status(502).json({ error: 'Backend request failed' });
    }
    const summary = await backendRes.json();
    return res.status(200).json(summary);
  } catch (err) {
    console.error('resend-welcome-email fetch error:', err);
    return res.status(502).json({ error: 'Could not reach backend' });
  }
}

async function resendApprovalEmail(req, res) {
  const { applicationId } = req.body;
  if (!applicationId) return res.status(400).json({ error: 'Missing applicationId' });

  const supabase = getSupabase();
  const { data: application, error: fetchError } = await supabase
    .from('applications').select('email, application_status').eq('id', applicationId).single();
  if (fetchError || !application) return res.status(404).json({ error: 'Application not found' });
  if (application.application_status !== 'Approved') {
    return res.status(400).json({ error: 'Can only resend approval email for Approved applications' });
  }
  if (!application.email) return res.status(400).json({ error: 'Application has no email address' });

  const BACKEND_URL = process.env.BACKEND_URL;
  const AUTO_REGISTER_API_KEY = process.env.AUTO_REGISTER_API_KEY;
  if (!BACKEND_URL || !AUTO_REGISTER_API_KEY) {
    return res.status(500).json({ error: 'Backend not configured' });
  }

  try {
    const backendRes = await fetch(`${BACKEND_URL}/api/internal/resend-welcome-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': AUTO_REGISTER_API_KEY },
      body: JSON.stringify([application.email]),
    });
    if (!backendRes.ok) {
      const err = await backendRes.json().catch(() => ({}));
      console.error('resend-approval-email backend error:', err);
      return res.status(502).json({ error: 'Backend request failed' });
    }
    const summary = await backendRes.json();
    // summary: { sent, skipped, notFound }
    if (summary.skipped?.includes(application.email)) {
      return res.status(200).json({ success: true, status: 'skipped', message: 'User has already set up their account — no email was sent.' });
    }
    if (summary.notFound?.includes(application.email)) {
      return res.status(200).json({ success: false, status: 'notFound', message: 'No platform account found for this email address.' });
    }
    return res.status(200).json({ success: true, status: 'sent', message: 'Approval email resent successfully.' });
  } catch (err) {
    console.error('resend-approval-email fetch error:', err);
    return res.status(502).json({ error: 'Could not reach backend' });
  }
}

const POST_ACTIONS = { approve, reject, 'resend-photos': resendPhotos, 'delete-application': deleteApplication, 'delete-photo': deletePhoto, 'check-password-status': checkPasswordStatus, 'resend-welcome-email': resendWelcomeEmail, 'resend-approval-email': resendApprovalEmail };
const GET_ACTIONS  = { 'calculator-leads': calculatorLeads };

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;
  const user = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  let fn;
  if (req.method === 'POST') {
    fn = POST_ACTIONS[action];
  } else if (req.method === 'GET') {
    fn = GET_ACTIONS[action];
  }

  if (!fn) return res.status(405).json({ error: 'Method not allowed or unknown action' });

  try {
    return await fn(req, res);
  } catch (error) {
    console.error(`Admin [${action}] error:`, error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
