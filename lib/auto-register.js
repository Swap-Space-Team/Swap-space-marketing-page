// Shared helper for registering an approved applicant on the platform backend.
//
// Used by both the admin approve flow (manual approval) and the submit-application
// flow (geographic auto-approval) so the two call sites never drift apart. The
// backend creates the user account and sends the password-setup / welcome email.

// Where the SPA lives — the origin of the password-setup link, and not the same host as
// BACKEND_URL, which is the API this file calls. Hardcoded to match the app links already spread
// across the marketing HTML; set APP_URL to point a preview at a different app deployment.
const APP_ORIGIN = process.env.APP_URL || 'https://app.swap-space.com';

// The password-setup link is a credential, so we only pass one along when it points at the app
// origin — a misconfigured or compromised backend must not be able to turn the confirmation screen
// into an open redirect. Fails closed: anything unexpected drops the link and the caller falls back
// to the emailed one. Never log the link itself.
function validateSetupLink(link) {
  if (!link) {
    console.warn('Backend returned no password-setup link — check it is running a version that includes one');
    return null;
  }

  try {
    const url = new URL(link);
    if (url.origin !== new URL(APP_ORIGIN).origin) {
      console.warn(`Password-setup link origin did not match ${APP_ORIGIN} — dropping it`);
      return null;
    }
    return url.toString();
  } catch {
    console.warn('Password-setup link was not a valid URL — dropping it');
    return null;
  }
}

// Calls BACKEND_URL/api/internal/auto-register with a hard timeout.
//
// Returns one of:
//   { ok: true, passwordSetupLink }           — link is null if absent or failed origin validation
//   { ok: false, notConfigured: true }        — BACKEND_URL / API key not set
//   { ok: false, timedOut: true }             — exceeded timeoutMs
//   { ok: false, status, error }              — backend rejected or unreachable
export async function autoRegisterUser({ email, name, telephone, timeoutMs = 9000 }) {
  const BACKEND_URL = process.env.BACKEND_URL;
  const AUTO_REGISTER_API_KEY = process.env.AUTO_REGISTER_API_KEY;

  if (!BACKEND_URL || !AUTO_REGISTER_API_KEY) {
    return { ok: false, notConfigured: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BACKEND_URL}/api/internal/auto-register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-API-Key': AUTO_REGISTER_API_KEY,
      },
      body: JSON.stringify({ email, name, telephone }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, status: res.status, error: err };
    }

    const body = await res.json().catch(() => ({}));
    return { ok: true, passwordSetupLink: validateSetupLink(body.passwordSetupLink) };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, timedOut: true };
    }
    return { ok: false, error: err?.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}
