import { createClient } from '@supabase/supabase-js';

// Shared admin gate for every /api/* handler behind the admin pages.
//
// A valid Supabase session is not enough on its own: any user in the Supabase
// project would pass. The admin must also be listed in ADMIN_EMAILS
// (comma-separated). If ADMIN_EMAILS is unset, nobody is let in — failing open
// would silently undo the allowlist.
//
// Status codes matter to the browser: adminFetch() bounces to the login screen
// on 401 only. So 401 means "no valid session"; 403 means "signed in, but not
// an admin", which must not redirect (that would loop through the login page).

function allowedEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

// Returns the Supabase user for a valid Bearer JWT, or null.
async function getSessionUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const authClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: { user }, error } = await authClient.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

// Sends 401/403 itself and returns null when the caller isn't an admin;
// otherwise returns the Supabase user. Usage:
//   const user = await requireAdmin(req, res);
//   if (!user) return;
export async function requireAdmin(req, res) {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  const allowed = allowedEmails();
  if (allowed.length === 0) {
    console.error('ADMIN_EMAILS is not set — refusing all admin requests.');
    res.status(403).json({ error: 'Admin access is not configured on the server.' });
    return null;
  }
  if (!allowed.includes((user.email || '').toLowerCase())) {
    res.status(403).json({ error: 'This account does not have admin access.' });
    return null;
  }
  return user;
}
