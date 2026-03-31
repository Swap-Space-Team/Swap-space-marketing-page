// Shared admin utilities — Supabase client init + auth helpers

// ── Custom modal system ────────────────────────────────────────────────────

let _modalResolve = null;

(function injectAdminModal() {
  const el = document.createElement('div');
  el.id = 'adminModal';
  el.className = 'admin-modal-overlay';
  el.innerHTML = `
    <div class="admin-modal-card">
      <div class="admin-modal-icon" id="adminModalIcon"></div>
      <h3 id="adminModalTitle"></h3>
      <p id="adminModalMessage"></p>
      <div class="admin-modal-btns" id="adminModalBtns"></div>
    </div>
  `;
  document.body.appendChild(el);
})();

function _variantIcon(variant) {
  const icons = {
    danger: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    warning: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#D97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#079455" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  };
  return icons[variant] || icons.info;
}

function _openAdminModal({ title, message, confirmText, cancelText, variant, alertOnly }) {
  return new Promise((resolve) => {
    _modalResolve = resolve;
    document.getElementById('adminModalIcon').className = `admin-modal-icon ${variant}`;
    document.getElementById('adminModalIcon').innerHTML = _variantIcon(variant);
    document.getElementById('adminModalTitle').textContent = title;
    document.getElementById('adminModalMessage').textContent = message;

    const confirmClass = variant === 'danger' ? 'btn btn-danger-solid' : 'btn btn-primary';
    document.getElementById('adminModalBtns').innerHTML = alertOnly
      ? `<button class="btn btn-primary" onclick="_closeAdminModal(true)">OK</button>`
      : `<button class="btn btn-secondary" onclick="_closeAdminModal(false)">${cancelText || 'Cancel'}</button>
         <button class="${confirmClass}" onclick="_closeAdminModal(true)">${confirmText || 'Confirm'}</button>`;

    document.getElementById('adminModal').classList.add('active');
  });
}

function _closeAdminModal(result) {
  document.getElementById('adminModal').classList.remove('active');
  if (_modalResolve) { _modalResolve(result); _modalResolve = null; }
}

function showConfirm({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', variant = 'danger' }) {
  return _openAdminModal({ title, message, confirmText, cancelText, variant, alertOnly: false });
}

function showAlert({ title, message, variant = 'info' }) {
  return _openAdminModal({ title, message, variant, alertOnly: true });
}

// ── End modal system ───────────────────────────────────────────────────────


let _supabase = null;
let _configPromise = null;

async function loadConfig() {
  if (!_configPromise) {
    _configPromise = fetch('/api/config')
      .then(r => r.json())
      .then(({ url, anonKey }) => ({ url, anonKey }));
  }
  return _configPromise;
}

async function getSupabase() {
  if (!_supabase) {
    const { url, anonKey } = await loadConfig();
    _supabase = window.supabase.createClient(url, anonKey);
  }
  return _supabase;
}

async function getSession() {
  const sb = await getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  return session;
}

async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.href = '/admin';
    return null;
  }
  return session;
}

async function signOut() {
  const sb = await getSupabase();
  await sb.auth.signOut();
  window.location.href = '/admin';
}

async function adminFetch(url, options = {}) {
  const session = await getSession();
  if (!session) {
    window.location.href = '/admin';
    return null;
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
    ...(options.headers || {}),
  };

  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    window.location.href = '/admin';
    return null;
  }
  return response;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function statusBadge(status) {
  const colors = {
    'Photos Requested': 'background: #FEF3C7; color: #92400E;',
    'Photos Received': 'background: #DBEAFE; color: #1E40AF;',
    'Approved': 'background: #D1FAE5; color: #065F46;',
    'Rejected': 'background: #FEE2E2; color: #991B1B;',
  };
  const style = colors[status] || 'background: #F3F4F6; color: #374151;';
  return `<span style="display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 500; ${style}">${status || 'Unknown'}</span>`;
}
