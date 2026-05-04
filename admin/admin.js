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


// ── Change Password modal ──────────────────────────────────────────────────

(function injectChangePasswordModal() {
  const el = document.createElement('div');
  el.id = 'changePasswordModal';
  el.className = 'admin-modal-overlay';
  el.innerHTML = `
    <div class="admin-modal-card">
      <div class="admin-modal-icon info">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#079455" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>
      <h3>Change Password</h3>
      <p>Enter and confirm your new password.</p>
      <div class="cpw-fields">
        <div class="cpw-field">
          <label class="cpw-label">New password</label>
          <input type="password" id="cpwNew" class="cpw-input" placeholder="Minimum 8 characters" autocomplete="new-password">
        </div>
        <div class="cpw-field">
          <label class="cpw-label">Confirm password</label>
          <input type="password" id="cpwConfirm" class="cpw-input" placeholder="Repeat new password" autocomplete="new-password">
        </div>
        <p id="cpwError" class="cpw-error"></p>
      </div>
      <div class="admin-modal-btns" style="margin-top: 20px;">
        <button class="btn btn-secondary" onclick="_closeChangePasswordModal()">Cancel</button>
        <button class="btn btn-primary" id="cpwSaveBtn" onclick="_submitPasswordChange()">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);
})();

function showChangePassword() {
  document.getElementById('cpwNew').value = '';
  document.getElementById('cpwConfirm').value = '';
  document.getElementById('cpwError').textContent = '';
  document.getElementById('cpwSaveBtn').disabled = false;
  document.getElementById('cpwSaveBtn').textContent = 'Save';
  document.getElementById('changePasswordModal').classList.add('active');
}

function _closeChangePasswordModal() {
  document.getElementById('changePasswordModal').classList.remove('active');
}

async function _submitPasswordChange() {
  const newPw = document.getElementById('cpwNew').value;
  const confirmPw = document.getElementById('cpwConfirm').value;
  const errorEl = document.getElementById('cpwError');
  const saveBtn = document.getElementById('cpwSaveBtn');

  errorEl.textContent = '';

  if (newPw.length < 8) {
    errorEl.textContent = 'Password must be at least 8 characters.';
    return;
  }
  if (newPw !== confirmPw) {
    errorEl.textContent = 'Passwords do not match.';
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    const sb = await getSupabase();
    const { error } = await sb.auth.updateUser({ password: newPw });

    if (error) {
      errorEl.textContent = error.message;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      return;
    }

    _closeChangePasswordModal();
    await showAlert({ title: 'Password Updated', message: 'Your password has been changed successfully.', variant: 'info' });
  } catch (err) {
    errorEl.textContent = 'Something went wrong. Please try again.';
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }
}

// ── End Change Password modal ──────────────────────────────────────────────


let _supabase = null;
let _configPromise = null;

async function loadConfig() {
  if (!_configPromise) {
    const cached = sessionStorage.getItem('_sbcfg');
    if (cached) {
      const cfg = JSON.parse(cached);
      _configPromise = Promise.resolve(cfg);
    } else {
      _configPromise = fetch('/api/config')
        .then(r => r.json())
        .then(({ url, anonKey }) => {
          const cfg = { url, anonKey };
          sessionStorage.setItem('_sbcfg', JSON.stringify(cfg));
          return cfg;
        });
    }
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

function toggleProfileMenu(e) {
  e.stopPropagation();
  document.getElementById('profileDropdown').classList.toggle('open');
}

function closeProfileMenu() {
  const dd = document.getElementById('profileDropdown');
  if (dd) dd.classList.remove('open');
}

// Close dropdown when clicking anywhere outside
document.addEventListener('click', () => closeProfileMenu());

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

// ── Toast system ──────────────────────────────────────────────────────────────

(function injectToastStyles() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes toastIn  { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes toastOut { from { opacity: 1; transform: translateY(0); }    to { opacity: 0; transform: translateY(-8px); } }
    #adminToastContainer { position: fixed; top: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 10px; pointer-events: none; }
    .admin-toast { pointer-events: all; animation: toastIn 0.22s ease; border-radius: 10px; padding: 14px 16px; min-width: 280px; max-width: 400px; box-shadow: 0 4px 18px rgba(0,0,0,0.12); }
    .admin-toast--info    { background: #f0fdf4; border: 1px solid #bbf7d0; }
    .admin-toast--warning { background: #fffbeb; border: 1px solid #fde68a; }
    .admin-toast--danger  { background: #fef2f2; border: 1px solid #fecaca; }
    .admin-toast-header   { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .admin-toast-title    { margin: 0; font-size: 13px; font-weight: 600; }
    .admin-toast--info    .admin-toast-title { color: #065F46; }
    .admin-toast--warning .admin-toast-title { color: #92400e; }
    .admin-toast--danger  .admin-toast-title { color: #991b1b; }
    .admin-toast-line     { margin: 4px 0 0; font-size: 12px; color: #374151; line-height: 1.5; }
    .admin-toast-close    { background: none; border: none; cursor: pointer; color: #9ca3af; font-size: 17px; line-height: 1; padding: 0; flex-shrink: 0; margin-top: -1px; }
    .admin-toast-close:hover { color: #6b7280; }
  `;
  document.head.appendChild(style);

  const container = document.createElement('div');
  container.id = 'adminToastContainer';
  document.body.appendChild(container);
})();

function showToast({ title, lines = [], variant = 'info', duration = 7000 }) {
  const container = document.getElementById('adminToastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `admin-toast admin-toast--${variant}`;
  toast.innerHTML = `
    <div class="admin-toast-header">
      <div>
        <p class="admin-toast-title">${title}</p>
        ${lines.map(l => `<p class="admin-toast-line">${l}</p>`).join('')}
      </div>
      <button class="admin-toast-close" aria-label="Dismiss">&times;</button>
    </div>
  `;

  toast.querySelector('.admin-toast-close').addEventListener('click', () => dismissToast(toast));
  container.appendChild(toast);

  const timer = setTimeout(() => dismissToast(toast), duration);
  toast._dismissTimer = timer;
}

function dismissToast(toast) {
  clearTimeout(toast._dismissTimer);
  toast.style.animation = 'toastOut 0.22s ease forwards';
  setTimeout(() => toast.remove(), 220);
}

// ── End Toast system ──────────────────────────────────────────────────────────


function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ── CSV export utility ────────────────────────────────────────────────────────

function downloadCSV(rows, filename) {
  const escape = val => {
    if (val == null) return '';
    const str = String(val);
    // Wrap in quotes if value contains comma, double-quote, or newline
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };
  const csv = '﻿' + rows.map(row => row.map(escape).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// ── End CSV export utility ────────────────────────────────────────────────────

function statusBadge(status) {
  const colors = {
    'Application Received': 'background: #EDE9FE; color: #5B21B6;',
    'Photos Requested': 'background: #FEF3C7; color: #92400E;',
    'Photos Received': 'background: #DBEAFE; color: #1E40AF;',
    'Approved': 'background: #D1FAE5; color: #065F46;',
    'Rejected': 'background: #FEE2E2; color: #991B1B;',
    'Completed': 'background: #E0E7FF; color: #3730A3;',
  };
  const style = colors[status] || 'background: #F3F4F6; color: #374151;';
  return `<span style="display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 500; ${style}">${status || 'Unknown'}</span>`;
}
