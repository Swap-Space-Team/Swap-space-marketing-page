import { createClient } from '@supabase/supabase-js';
import { sendSms } from '../lib/bird.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Cap on how many recipients a single synchronous send handles. Serverless
// functions have a wall-clock budget; larger audiences need a queue (future).
const MAX_RECIPIENTS = 200;

// ── Auth + Supabase (same pattern as api/admin.js) ──────────────────────────
async function verifyAdmin(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const authClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: { user }, error } = await authClient.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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

// ── Action handlers ─────────────────────────────────────────────────────────

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

  // Normalize + dedupe within the batch; drop rows with unusable phones.
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
    return res.status(500).json({ error: 'Failed to read applications' });
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
      application_id: a.id,
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
    return res.status(500).json({ error: 'Failed to sync applications' });
  }
  return res.status(200).json({ success: true, synced: data?.length || 0 });
}

// Resolve the recipient set from explicit ids, ad-hoc phones, and/or a segment.
async function resolveRecipients(supabase, { contactIds, phones, segment }) {
  const byPhone = new Map(); // phone -> { phone, contact_id }

  if (Array.isArray(contactIds) && contactIds.length) {
    const { data } = await supabase.from('messaging_contacts').select('id, phone').in('id', contactIds);
    for (const c of data || []) byPhone.set(c.phone, { phone: c.phone, contact_id: c.id });
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

async function sendSmsAction(req, res) {
  const supabase = getSupabase();
  const { body, contactIds, phones, segment, campaignName } = req.body || {};

  const text = (body || '').trim();
  if (!text) return res.status(400).json({ error: 'Message body is required' });

  let recipients = await resolveRecipients(supabase, { contactIds, phones, segment });
  const requested = recipients.length;
  if (requested === 0) return res.status(400).json({ error: 'No recipients resolved' });

  // Suppress opt-outs before doing anything else.
  const optouts = await getOptoutSet(supabase);
  const suppressed = recipients.filter(r => optouts.has(r.phone)).length;
  recipients = recipients.filter(r => !optouts.has(r.phone));

  if (recipients.length > MAX_RECIPIENTS) {
    return res.status(400).json({ error: `Too many recipients (${recipients.length}). Narrow the segment to ${MAX_RECIPIENTS} or fewer.` });
  }
  if (recipients.length === 0) {
    return res.status(400).json({ error: 'All resolved recipients are opted out', suppressed });
  }

  // Record a campaign for bulk, named sends.
  let campaignId = null;
  if (campaignName && recipients.length > 1) {
    const { data: campaign } = await supabase
      .from('messaging_campaigns')
      .insert({ name: campaignName, channel: 'sms', body: text, segment: segment || {}, status: 'sending', audience_count: recipients.length, created_by: req._adminEmail || null })
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

  // Best-effort log write (never fail the send response on a logging error).
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

// ── Router ──────────────────────────────────────────────────────────────────

const POST_ACTIONS = {
  'contact-add': contactAdd,
  'contacts-import': contactsImport,
  'sync-applications': syncApplications,
  'send-sms': sendSmsAction,
  'optout-add': optoutAdd,
};
const GET_ACTIONS = {
  'contacts-list': contactsList,
  'log-list': logList,
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;
  const user = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req._adminEmail = user.email;

  let fn;
  if (req.method === 'POST') fn = POST_ACTIONS[action];
  else if (req.method === 'GET') fn = GET_ACTIONS[action];
  if (!fn) return res.status(405).json({ error: 'Method not allowed or unknown action' });

  try {
    return await fn(req, res);
  } catch (error) {
    console.error(`Messaging [${action}] error:`, error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
