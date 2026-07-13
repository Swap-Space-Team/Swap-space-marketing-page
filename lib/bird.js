import { BirdClient } from '@messagebird/sdk';

// Shared Bird (MessageBird) client. Constructed lazily so importing this module
// never throws when BIRD_API_KEY is absent (e.g. local dev, preview builds).
let _bird = null;

/**
 * Returns a memoized BirdClient, or null when SMS isn't available (missing or
 * malformed BIRD_API_KEY). Callers should treat null as "SMS not available" and
 * degrade gracefully, mirroring how the codebase gates Resend/Slack/Meta on env.
 *
 * BIRD_API_KEY must be a real Bird key (`bk_{region}_{token}`, e.g.
 * `bk_eu1_...`) — the SDK derives the API region from it and throws at
 * construction otherwise, which we catch here rather than let bubble up.
 */
export function getBird() {
  if (_bird) return _bird;
  const apiKey = process.env.BIRD_API_KEY;
  if (!apiKey) return null;
  try {
    _bird = new BirdClient({ apiKey });
    return _bird;
  } catch (err) {
    console.error('Bird client init failed (check BIRD_API_KEY format):', err.message);
    return null;
  }
}

/**
 * Best-effort SMS send. Never throws — returns a normalized result the caller
 * can log to message_log:
 *   { ok: true,  data }                     on success
 *   { ok: false, skipped: true, error }     when Bird isn't configured
 *   { ok: false, error }                    on a send/validation failure
 *
 * `category` defaults to 'transactional' since these messages concern a
 * recipient's application or membership. `from` falls back to BIRD_SMS_FROM;
 * when neither is set, Bird selects an eligible sender for the destination.
 */
export async function sendSms({ to, text, category = 'transactional', from } = {}) {
  const bird = getBird();
  if (!bird) {
    return { ok: false, skipped: true, error: 'BIRD_API_KEY not set' };
  }

  const sender = from || process.env.BIRD_SMS_FROM;
  const params = { to, text, category };
  if (sender) params.from = sender;

  try {
    // `.safe()` resolves to { data, error } instead of throwing.
    const { data, error } = await bird.sms.send(params).safe();
    if (error) return { ok: false, error };
    return { ok: true, data };
  } catch (err) {
    // Defensive: network/unexpected failures should never bubble to the caller.
    return { ok: false, error: err };
  }
}

export default getBird;
