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
const REPORTS_PATH = '/sms/1/reports';

function apiBase() {
  const apiKey = process.env.INFOBIP_API_KEY;
  const baseUrl = process.env.INFOBIP_BASE_URL;
  if (!apiKey || !baseUrl) return null;
  const origin = baseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return { apiKey, origin };
}

// Translate an Infobip status/error pair into our messaging_log status enum
// plus a short human-readable detail line.
export function decodeInfobipStatus(status = {}, error = null) {
  const group = status?.groupName || '';
  const enumByGroup = {
    DELIVERED: 'delivered',
    PENDING: 'sent',
    UNDELIVERABLE: 'undelivered',
    EXPIRED: 'failed',
    REJECTED: 'failed',
  };
  const enumStatus = enumByGroup[group] || 'sent';

  // Surface a human reason only when something went wrong. Infobip error
  // groupId 0 means "no error".
  let detail = null;
  const hasError = error && error.groupId != null && error.groupId !== 0;
  if (hasError) {
    detail = error.description || error.name || null;
    if (error.groupName && error.description && error.groupName !== error.description) {
      detail = `${error.description} (${error.groupName.toLowerCase().replace(/_/g, ' ')})`;
    }
  } else if (enumStatus === 'undelivered' || enumStatus === 'failed') {
    detail = status.description || status.name || 'Not delivered';
  } else if (enumStatus === 'delivered') {
    detail = 'Delivered to handset';
  }
  return { status: enumStatus, detail };
}

/**
 * Best-effort SMS send. Never throws — returns a normalized result the caller
 * logs to messaging_log:
 *   { ok: true,  data: { id, status } }        accepted by Infobip
 *   { ok: false, skipped: true, error }        when Infobip isn't configured
 *   { ok: false, error }                        on a send/validation failure
 */
export async function sendSms({ to, text, from } = {}) {
  const base = apiBase();
  if (!base) {
    return { ok: false, skipped: true, error: 'INFOBIP_API_KEY / INFOBIP_BASE_URL not set' };
  }

  const sender = from || process.env.INFOBIP_SENDER;
  const message = { destinations: [{ to }], text };
  if (sender) message.from = sender;

  try {
    const resp = await fetch(`https://${base.origin}${SEND_PATH}`, {
      method: 'POST',
      headers: {
        'Authorization': `App ${base.apiKey}`,
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
    return { ok: true, data: { id: messageId, status: msg?.status?.description || group } };
  } catch (err) {
    return { ok: false, error: { message: err.message } };
  }
}

/**
 * Pull outstanding delivery reports from Infobip. Each report is returned once
 * (a consuming read), so callers must persist what they get. Returns normalized
 * rows: { messageId, status, detail }.
 *   { ok: true, reports: [...] }
 *   { ok: false, skipped: true } when not configured
 *   { ok: false, error }
 */
export async function fetchDeliveryReports(limit = 1000) {
  const base = apiBase();
  if (!base) return { ok: false, skipped: true, reports: [] };

  try {
    const resp = await fetch(`https://${base.origin}${REPORTS_PATH}?limit=${limit}`, {
      headers: { 'Authorization': `App ${base.apiKey}`, 'Accept': 'application/json' },
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const detail = data?.requestError?.serviceException?.text || `HTTP ${resp.status}`;
      return { ok: false, error: { message: detail }, reports: [] };
    }
    const reports = (data?.results || []).map(r => {
      const { status, detail } = decodeInfobipStatus(r.status, r.error);
      return { messageId: r.messageId, status, detail };
    });
    return { ok: true, reports };
  } catch (err) {
    return { ok: false, error: { message: err.message }, reports: [] };
  }
}

export default sendSms;
