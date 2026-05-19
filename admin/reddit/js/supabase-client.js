// js/supabase-client.js — initializes the Supabase client.
//
// DESIGN DECISION (deviation from spec section 4, documented in README):
// The spec's Option A says "hardcode the anon key in the bundle". This project
// already ships an `/api/config` serverless endpoint that returns
// { url, anonKey } from server-side env vars — the existing /admin app uses it.
// We reuse that here so we don't commit a key to the repo. The security model
// is unchanged (still Option A: open RLS, the parent /admin gate is the real
// boundary) — the anon key is still effectively public, just delivered at
// runtime instead of baked in. If `/api/config` is unreachable, we fall back
// to the inline constants below (fill them in for a pure-static deploy).

const FALLBACK = {
  // Project URL is not a secret (it is in every request). Pre-filled for this
  // project; the anon key is intentionally left blank — `/api/config` supplies
  // it. For a static host with no /api/config, paste the anon key here.
  url: 'https://uzxedeslleiotjwkuvvt.supabase.co',
  anonKey: '',
};

async function loadConfig() {
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      if (j && j.url && j.anonKey) return { url: j.url, anonKey: j.anonKey };
    }
  } catch {
    /* fall through to inline fallback */
  }
  if (!FALLBACK.anonKey) {
    console.warn(
      '[supabase-client] /api/config unavailable and no inline anon key set. ' +
        'Set FALLBACK.anonKey in js/supabase-client.js for static hosting.'
    );
  }
  return FALLBACK;
}

if (!window.supabase || !window.supabase.createClient) {
  throw new Error(
    'supabase-js UMD bundle not loaded. The <script src="…supabase-js@2"> ' +
      'tag must come before this module in index.html.'
  );
}

const { url, anonKey } = await loadConfig();

export const supabase = window.supabase.createClient(url, anonKey, {
  auth: { persistSession: false },
});
