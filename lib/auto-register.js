// Shared helper for registering an approved applicant on the platform backend.
//
// Used by both the admin approve flow (manual approval) and the submit-application
// flow (geographic auto-approval) so the two call sites never drift apart. The
// backend creates the user account and sends the password-setup / welcome email.

// Calls BACKEND_URL/api/internal/auto-register with a hard timeout.
//
// Returns one of:
//   { ok: true }
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
    return { ok: true };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, timedOut: true };
    }
    return { ok: false, error: err?.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}
