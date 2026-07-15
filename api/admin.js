import { createClient } from '@supabase/supabase-js';
import { autoRegisterUser } from '../lib/auto-register.js';
import { sendSms, fetchDeliveryReports } from '../lib/infobip.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Cap on how many recipients a single synchronous SMS send handles.
const MAX_RECIPIENTS = 200;

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

  const register = await autoRegisterUser({
    email: application.email,
    name: application.name,
    telephone: application.phone,
  });

  if (register.notConfigured) {
    console.warn('BACKEND_URL or AUTO_REGISTER_API_KEY not set — skipping auto-register');
  } else if (!register.ok) {
    console.error('Auto-register failed:', register.timedOut ? 'timed out' : register.error);
    return res.status(200).json({ success: true, warning: 'Application approved but failed to register user on the platform. Please register them manually.' });
  } else {
    console.log(`Auto-register succeeded for ${application.email}`);
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

// ── Messaging (Bird SMS) handlers ─────────────────────────────────────────────
// Folded in here (rather than a separate api/messaging.js) to stay under
// Vercel's 12-function limit. Reuses verifyAdmin/getSupabase above.

// Normalize to E.164 (`+` followed by 8–15 digits). Returns null if implausible.
function normalizePhone(raw) {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return '+' + digits;
}

// Load the suppression set once per request.
async function getOptoutSet(supabase) {
  const { data } = await supabase.from('messaging_optouts').select('phone');
  return new Set((data || []).map(r => r.phone));
}

async function contactsList(req, res) {
  const supabase = getSupabase();
  const search = (req.query.search || '').trim();
  const source = req.query.source;

  let query = supabase
    .from('messaging_contacts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1000);
  if (source) query = query.eq('source', source);
  if (search) query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);

  const { data: contacts, error } = await query;
  if (error) {
    console.error('contactsList error:', error);
    return res.status(500).json({ error: 'Failed to load contacts' });
  }

  const optouts = await getOptoutSet(supabase);
  const annotated = (contacts || []).map(c => ({ ...c, opted_out: optouts.has(c.phone) }));
  return res.status(200).json({ contacts: annotated });
}

async function contactAdd(req, res) {
  const supabase = getSupabase();
  const { phone, name, email, city, country } = req.body || {};
  const normalized = normalizePhone(phone);
  if (!normalized) return res.status(400).json({ error: 'Invalid phone number (use international format, e.g. +15551234567)' });

  const { data, error } = await supabase
    .from('messaging_contacts')
    .upsert(
      { phone: normalized, name: name || null, email: email || null, city: city || null, country: country || null, source: 'manual', updated_at: new Date().toISOString() },
      { onConflict: 'phone' }
    )
    .select()
    .single();
  if (error) {
    console.error('contactAdd error:', error);
    return res.status(500).json({ error: 'Failed to add contact' });
  }
  return res.status(200).json({ success: true, contact: data });
}

async function contactsImport(req, res) {
  const supabase = getSupabase();
  const { contacts } = req.body || {};
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: 'Provide a non-empty contacts array' });
  }

  const byPhone = new Map();
  let invalid = 0;
  for (const c of contacts) {
    const phone = normalizePhone(c.phone);
    if (!phone) { invalid++; continue; }
    byPhone.set(phone, {
      phone,
      name: c.name || null,
      email: c.email || null,
      city: c.city || null,
      country: c.country || null,
      source: 'import',
      updated_at: new Date().toISOString(),
    });
  }
  const rows = [...byPhone.values()];
  if (rows.length === 0) return res.status(400).json({ error: 'No valid phone numbers found', invalid });

  const { data, error } = await supabase
    .from('messaging_contacts')
    .upsert(rows, { onConflict: 'phone' })
    .select('phone');
  if (error) {
    console.error('contactsImport error:', error);
    return res.status(500).json({ error: 'Failed to import contacts' });
  }
  return res.status(200).json({ success: true, imported: data?.length || 0, invalid });
}

// Pull applicants (who have a phone) into the contacts book so they're sendable.
async function syncApplications(req, res) {
  const supabase = getSupabase();
  const { data: apps, error } = await supabase
    .from('applications')
    .select('id, name, email, phone, city, country, sms_consent, sms_consent_at')
    .not('phone', 'is', null);
  if (error) {
    console.error('syncApplications fetch error:', error);
    return res.status(500).json({ error: `Failed to read applications: ${error.message || ''} ${error.details || ''} ${error.hint || ''} [${error.code || ''}]`.trim() });
  }

  const byPhone = new Map();
  for (const a of apps || []) {
    const phone = normalizePhone(a.phone);
    if (!phone) continue;
    byPhone.set(phone, {
      phone,
      name: a.name || null,
      email: a.email || null,
      city: a.city || null,
      country: a.country || null,
      source: 'application',
      // application_id intentionally not written: applications.id is a UUID but
      // existing messaging_contacts.application_id is bigint in already-migrated
      // DBs. The schema now declares it uuid; restore this write once existing
      // DBs are retyped. Nothing reads application_id today, so this is a no-op.
      sms_consent: a.sms_consent === true,
      sms_consent_at: a.sms_consent_at || null,
      updated_at: new Date().toISOString(),
    });
  }
  const rows = [...byPhone.values()];
  if (rows.length === 0) return res.status(200).json({ success: true, synced: 0 });

  const { data, error: upsertError } = await supabase
    .from('messaging_contacts')
    .upsert(rows, { onConflict: 'phone' })
    .select('phone');
  if (upsertError) {
    console.error('syncApplications upsert error:', upsertError);
    return res.status(500).json({ error: `Failed to sync applications: ${upsertError.message || ''} ${upsertError.details || ''} ${upsertError.hint || ''} [${upsertError.code || ''}]`.trim() });
  }
  return res.status(200).json({ success: true, synced: data?.length || 0 });
}

// Resolve the recipient set from explicit ids, ad-hoc phones, a filter object,
// and/or a saved segment (a tag on messaging_contacts.tags).
async function resolveRecipients(supabase, { contactIds, phones, segment, tag }) {
  const byPhone = new Map(); // phone -> { phone, contact_id }

  if (Array.isArray(contactIds) && contactIds.length) {
    const { data } = await supabase.from('messaging_contacts').select('id, phone').in('id', contactIds);
    for (const c of data || []) byPhone.set(c.phone, { phone: c.phone, contact_id: c.id });
  }

  if (tag) {
    const { data } = await supabase.from('messaging_contacts').select('id, phone').contains('tags', [tag]);
    for (const c of data || []) if (!byPhone.has(c.phone)) byPhone.set(c.phone, { phone: c.phone, contact_id: c.id });
  }

  if (segment && Object.keys(segment).length) {
    let q = supabase.from('messaging_contacts').select('id, phone');
    if (segment.source) q = q.eq('source', segment.source);
    if (segment.country) q = q.eq('country', segment.country);
    if (segment.city) q = q.eq('city', segment.city);
    const { data } = await q;
    for (const c of data || []) if (!byPhone.has(c.phone)) byPhone.set(c.phone, { phone: c.phone, contact_id: c.id });
  }

  if (Array.isArray(phones) && phones.length) {
    for (const raw of phones) {
      const phone = normalizePhone(raw);
      if (phone && !byPhone.has(phone)) byPhone.set(phone, { phone, contact_id: null });
    }
  }

  return [...byPhone.values()];
}

// ── Segments (backed by the messaging_contacts.tags array) ────────────────────

// List every segment (distinct tag) with its member count.
async function segmentsList(req, res) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('messaging_contacts').select('tags');
  if (error) {
    console.error('segmentsList error:', error);
    return res.status(500).json({ error: 'Failed to load segments' });
  }
  const counts = new Map();
  for (const row of data || []) for (const t of (row.tags || [])) counts.set(t, (counts.get(t) || 0) + 1);
  const segments = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return res.status(200).json({ segments });
}

// Members of a segment (contacts carrying the tag).
async function segmentMembers(req, res) {
  const supabase = getSupabase();
  const name = (req.query.segment || '').trim();
  if (!name) return res.status(400).json({ error: 'Missing segment' });
  const { data, error } = await supabase
    .from('messaging_contacts')
    .select('id, name, phone, source')
    .contains('tags', [name])
    .order('name');
  if (error) {
    console.error('segmentMembers error:', error);
    return res.status(500).json({ error: 'Failed to load members' });
  }
  const optouts = await getOptoutSet(supabase);
  return res.status(200).json({ members: (data || []).map(c => ({ ...c, opted_out: optouts.has(c.phone) })) });
}

// Add the segment tag to the selected contacts (creates the segment if new).
async function segmentAssign(req, res) {
  const supabase = getSupabase();
  const { segment, contactIds } = req.body || {};
  const name = (segment || '').trim();
  if (!name) return res.status(400).json({ error: 'Segment name is required' });
  if (!Array.isArray(contactIds) || contactIds.length === 0) return res.status(400).json({ error: 'Select at least one contact' });

  const { data: rows, error } = await supabase.from('messaging_contacts').select('id, tags').in('id', contactIds);
  if (error) {
    console.error('segmentAssign fetch error:', error);
    return res.status(500).json({ error: 'Failed to load contacts' });
  }
  let added = 0;
  for (const r of rows || []) {
    const tags = r.tags || [];
    if (tags.includes(name)) continue;
    const { error: upErr } = await supabase
      .from('messaging_contacts')
      .update({ tags: [...tags, name], updated_at: new Date().toISOString() })
      .eq('id', r.id);
    if (upErr) { console.error('segmentAssign update error:', upErr); continue; }
    added++;
  }
  return res.status(200).json({ success: true, added, segment: name });
}

// Remove one contact from a segment (strip the tag).
async function segmentUnassign(req, res) {
  const supabase = getSupabase();
  const { segment, contactId } = req.body || {};
  const name = (segment || '').trim();
  if (!name || !contactId) return res.status(400).json({ error: 'Missing segment or contact' });
  const { data: row, error } = await supabase.from('messaging_contacts').select('tags').eq('id', contactId).single();
  if (error || !row) return res.status(404).json({ error: 'Contact not found' });
  const tags = (row.tags || []).filter(t => t !== name);
  const { error: upErr } = await supabase
    .from('messaging_contacts')
    .update({ tags, updated_at: new Date().toISOString() })
    .eq('id', contactId);
  if (upErr) {
    console.error('segmentUnassign error:', upErr);
    return res.status(500).json({ error: 'Failed to update contact' });
  }
  return res.status(200).json({ success: true });
}

async function sendSmsAction(req, res) {
  const supabase = getSupabase();
  const { body, contactIds, phones, segment, tag, campaignName } = req.body || {};

  const text = (body || '').trim();
  if (!text) return res.status(400).json({ error: 'Message body is required' });

  let recipients = await resolveRecipients(supabase, { contactIds, phones, segment, tag });
  const requested = recipients.length;
  if (requested === 0) return res.status(400).json({ error: 'No recipients resolved' });

  const optouts = await getOptoutSet(supabase);
  const suppressed = recipients.filter(r => optouts.has(r.phone)).length;
  recipients = recipients.filter(r => !optouts.has(r.phone));

  if (recipients.length > MAX_RECIPIENTS) {
    return res.status(400).json({ error: `Too many recipients (${recipients.length}). Narrow the segment to ${MAX_RECIPIENTS} or fewer.` });
  }
  if (recipients.length === 0) {
    return res.status(400).json({ error: 'All resolved recipients are opted out', suppressed });
  }

  let campaignId = null;
  if (campaignName && recipients.length > 1) {
    const { data: campaign } = await supabase
      .from('messaging_campaigns')
      .insert({ name: campaignName, channel: 'sms', body: text, segment: segment || (tag ? { tag } : {}), status: 'sending', audience_count: recipients.length, created_by: req._adminEmail || null })
      .select('id')
      .single();
    campaignId = campaign?.id || null;
  }

  let sent = 0;
  let failed = 0;
  const logRows = [];
  for (const r of recipients) {
    const result = await sendSms({ to: r.phone, text });
    const ok = result.ok;
    if (ok) sent++; else failed++;
    logRows.push({
      contact_id: r.contact_id,
      phone: r.phone,
      direction: 'outbound',
      channel: 'sms',
      body: text,
      bird_message_id: ok ? (result.data?.id || null) : null,
      status: ok ? 'sent' : 'failed',
      error_code: ok ? null : (result.error?.code || result.error?.message || 'send_failed'),
      campaign_id: campaignId,
    });
  }

  const { error: logError } = await supabase.from('messaging_log').insert(logRows);
  if (logError) console.error('messaging_log insert error:', logError);

  if (campaignId) {
    await supabase.from('messaging_campaigns')
      .update({ status: failed === recipients.length ? 'failed' : 'sent', sent_count: sent, sent_at: new Date().toISOString() })
      .eq('id', campaignId);
  }

  return res.status(200).json({ success: true, requested, suppressed, sent, failed, campaignId });
}

async function optoutAdd(req, res) {
  const supabase = getSupabase();
  const phone = normalizePhone((req.body || {}).phone);
  if (!phone) return res.status(400).json({ error: 'Invalid phone number' });
  const { error } = await supabase
    .from('messaging_optouts')
    .upsert({ phone, reason: 'manual', opted_out_at: new Date().toISOString() }, { onConflict: 'phone' });
  if (error) {
    console.error('optoutAdd error:', error);
    return res.status(500).json({ error: 'Failed to add opt-out' });
  }
  return res.status(200).json({ success: true, phone });
}

async function logList(req, res) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('messaging_log')
    .select('id, phone, direction, body, status, error_code, campaign_id, created_at, messaging_contacts(name)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('logList error:', error);
    return res.status(500).json({ error: 'Failed to load message log' });
  }
  const rows = (data || []).map(r => ({
    id: r.id,
    phone: r.phone,
    name: r.messaging_contacts?.name || null,
    direction: r.direction,
    body: r.body,
    status: r.status,
    error_code: r.error_code,
    campaign_id: r.campaign_id,
    created_at: r.created_at,
  }));
  return res.status(200).json({ log: rows });
}

// Pull delivery reports from Infobip and fold the true, human-readable status
// into messaging_log (status: sent → delivered/undelivered/failed, with reason).
async function syncReports(req, res) {
  const { ok, reports, skipped, error } = await fetchDeliveryReports();
  if (skipped) return res.status(200).json({ updated: 0, note: 'Infobip not configured' });
  if (!ok) return res.status(502).json({ error: `Could not fetch delivery reports: ${error?.message || 'unknown'}` });
  if (!reports.length) return res.status(200).json({ updated: 0 });

  const supabase = getSupabase();
  let updated = 0;
  for (const r of reports) {
    if (!r.messageId) continue;
    const { data, error: upErr } = await supabase
      .from('messaging_log')
      .update({ status: r.status, error_code: r.detail || null, updated_at: new Date().toISOString() })
      .eq('bird_message_id', r.messageId)
      .select('id');
    if (upErr) { console.error('syncReports update error:', upErr); continue; }
    updated += data?.length || 0;
  }
  return res.status(200).json({ updated });
}

const POST_ACTIONS = {
  approve, reject, 'resend-photos': resendPhotos, 'delete-application': deleteApplication,
  'delete-photo': deletePhoto, 'check-password-status': checkPasswordStatus,
  'resend-welcome-email': resendWelcomeEmail, 'resend-approval-email': resendApprovalEmail,
  // Messaging
  'contact-add': contactAdd, 'contacts-import': contactsImport, 'sync-applications': syncApplications,
  'send-sms': sendSmsAction, 'optout-add': optoutAdd,
  'segment-assign': segmentAssign, 'segment-unassign': segmentUnassign,
  'sync-reports': syncReports,
};
const GET_ACTIONS  = {
  'calculator-leads': calculatorLeads,
  // Messaging
  'contacts-list': contactsList, 'log-list': logList,
  'segments-list': segmentsList, 'segment-members': segmentMembers,
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;
  const user = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req._adminEmail = user.email;

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
