// Infobip SMS helper. Exposes the same sendSms() interface as the old Bird
// helper so api/admin.js stays provider-agnostic — swapping providers is just
// a change of import. Uses plain fetch (like the Resend/Slack/Meta calls in
// this codebase), so there's no SDK dependency.
//
// Env:
//   INFOBIP_API_KEY   – API key from the Infobip portal (used as `App <key>`)
//   INFOBIP_BASE_URL  – your account's personalized host, e.g. xxxxx.api.infobip.com
//   INFOBIP_SENDER    – registered sender ID / number (optional default)

const SEND_PATH = '/sms/2/text/advanced';

/**
 * Best-effort SMS send. Never throws — returns a normalized result the caller
 * logs to messaging_log:
 *   { ok: true,  data: { id, status } }        accepted by Infobip
 *   { ok: false, skipped: true, error }        when Infobip isn't configured
 *   { ok: false, error }                        on a send/validation failure
 */
export async function sendSms({ to, text, from } = {}) {
  const apiKey = process.env.INFOBIP_API_KEY;
  const baseUrl = process.env.INFOBIP_BASE_URL;
  if (!apiKey || !baseUrl) {
    return { ok: false, skipped: true, error: 'INFOBIP_API_KEY / INFOBIP_BASE_URL not set' };
  }

  const sender = from || process.env.INFOBIP_SENDER;
  const origin = baseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const url = `https://${origin}${SEND_PATH}`;

  const message = { destinations: [{ to }], text };
  if (sender) message.from = sender;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `App ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ messages: [message] }),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      const detail =
        data?.requestError?.serviceException?.text ||
        data?.requestError?.serviceException?.messageId ||
        `HTTP ${resp.status}`;
      return { ok: false, error: { message: detail, status: resp.status } };
    }

    // Infobip returns 200 with a per-message status even for rejections, so
    // check the status group rather than just the HTTP code.
    const msg = data?.messages?.[0];
    const group = msg?.status?.groupName || '';
    const messageId = msg?.messageId || null;
    if (!messageId || group === 'REJECTED') {
      return { ok: false, error: { message: msg?.status?.description || 'Rejected by Infobip', code: msg?.status?.name, status: group }, data: { id: messageId } };
    }

    // `id` normalizes to the same shape the caller stored for Bird.
    return { ok: true, data: { id: messageId, status: msg?.status?.name || group } };
  } catch (err) {
    return { ok: false, error: { message: err.message } };
  }
}

export default sendSms;
