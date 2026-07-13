import { BirdClient } from '@messagebird/sdk';
import { createClient } from '@supabase/supabase-js';

// Signature verification is computed over the RAW request bytes, so we must
// disable Vercel's automatic JSON body parsing and read the stream ourselves.
export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Map Bird SMS delivery events → our messaging_log.status values.
const STATUS_MAP = {
  'sms.accepted': 'sent',
  'sms.sent': 'sent',
  'sms.delivered': 'delivered',
  'sms.undelivered': 'undelivered',
  'sms.failed': 'failed',
  'sms.rejected': 'failed',
  'sms.expired': 'failed',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.BIRD_API_KEY;
  const secret = process.env.BIRD_WEBHOOK_SECRET;
  if (!apiKey || !secret) {
    console.error('Bird webhook not configured (BIRD_API_KEY / BIRD_WEBHOOK_SECRET)');
    return res.status(503).json({ error: 'Webhook not configured' });
  }

  const raw = await readRawBody(req);

  // Verify + parse. unwrap() throws BirdWebhookVerificationError on a bad
  // signature, stale timestamp, or malformed headers — treat all as 400.
  let event;
  try {
    const bird = new BirdClient({ apiKey, webhooks: { secret } });
    event = bird.webhooks.unwrap(raw, req.headers);
  } catch (err) {
    console.error('Bird webhook verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const newStatus = STATUS_MAP[event?.type];
  if (!newStatus) {
    // Not a delivery-status event we track (e.g. email events). Ack so Bird
    // doesn't retry.
    return res.status(200).json({ ok: true, ignored: event?.type || 'unknown' });
  }

  const smsId = event?.data?.sms_id;
  if (!smsId) return res.status(200).json({ ok: true, ignored: 'no sms_id' });

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await supabase
      .from('messaging_log')
      .update({
        status: newStatus,
        error_code: event?.data?.error?.code || null,
        updated_at: new Date().toISOString(),
      })
      .eq('bird_message_id', smsId);
    if (error) console.error('messaging_log update error:', error);
  } catch (err) {
    console.error('Bird webhook DB error:', err);
    // Ack anyway — retrying won't fix a DB error, and Bird will keep retrying.
  }

  return res.status(200).json({ ok: true });
}
