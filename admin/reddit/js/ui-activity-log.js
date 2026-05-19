// js/ui-activity-log.js — log-an-activity form + the activity table.

import { state } from './state.js';
import { addActivity, deleteActivity } from './api.js';
import { getCurrentUser } from './current-user.js';
import { todayISO, formatDate, escapeHtml } from './util.js';
import { confirmDialog } from './modal.js';

const TYPE_PILL = { Post: 'pill-post', Reply: 'pill-reply', 'Browse find': 'pill-browse' };

export function renderActivityLog() {
  const root = document.getElementById('tab-activity');
  const rows = [...state.activity].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      (b.created_at || '').localeCompare(a.created_at || '')
  );
  const me = getCurrentUser();

  root.innerHTML = `
    <div class="card">
      <h3>Log an activity</h3>
      <form id="logForm" class="log-form" style="margin-top:12px">
        <div class="fld">
          <label>Date</label>
          <input type="date" name="date" value="${todayISO()}" required />
        </div>
        <div class="fld">
          <label>Who</label>
          <select name="who">
            <option ${me === 'Ola' ? 'selected' : ''}>Ola</option>
            <option ${me === 'Ezekiel' ? 'selected' : ''}>Ezekiel</option>
          </select>
        </div>
        <div class="fld">
          <label>Subreddit</label>
          <input type="text" name="subreddit" placeholder="r/travel" />
        </div>
        <div class="fld">
          <label>Type</label>
          <select name="type">
            <option>Post</option><option>Reply</option><option>Browse find</option>
          </select>
        </div>
        <div class="fld">
          <label>URL</label>
          <input type="url" name="url" placeholder="https://reddit.com/…" />
        </div>
        <div class="fld">
          <label>Upvotes</label>
          <input type="number" name="upvotes" />
        </div>
        <div class="fld span2">
          <label>Notes</label>
          <input type="text" name="notes" placeholder="What did you do?" />
        </div>
        <div class="fld">
          <label>Schedule day #</label>
          <input type="number" name="schedule_day" />
        </div>
        <div class="form-actions">
          <span class="form-err" id="logFormErr"></span>
          <button type="submit" class="btn btn-primary">+ Add entry</button>
        </div>
      </form>
    </div>

    <div class="tbl-wrap" style="margin-top:14px">
      <table>
        <thead>
          <tr>
            <th>Date</th><th>Who</th><th>Subreddit</th><th>URL</th><th>Type</th>
            <th>Upvotes</th><th>Notes</th><th>Day #</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length
              ? rows.map(rowHtml).join('')
              : `<tr><td colspan="9"><div class="empty-state">No activity logged yet.</div></td></tr>`
          }
        </tbody>
      </table>
    </div>
  `;

  wire(root);
}

function rowHtml(r) {
  const auto = r.source && r.source !== 'manual';
  const pill = TYPE_PILL[r.type] || 'pill-browse';
  return `<tr class="${auto ? 'auto-entry' : ''}">
    <td>${formatDate(r.date)}</td>
    <td><span class="who-${(r.who || '').toLowerCase()}">${escapeHtml(r.who || '')}</span></td>
    <td>${escapeHtml(r.subreddit || '')}</td>
    <td>${
      r.url
        ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">link ↗</a>`
        : '<span class="cell-muted">—</span>'
    }</td>
    <td><span class="pill ${pill}">${escapeHtml(r.type)}</span></td>
    <td>${r.upvotes ?? '<span class="cell-muted">—</span>'}</td>
    <td>${escapeHtml(r.notes || '')}${
      auto ? `<span class="auto-badge" title="source: ${escapeHtml(r.source)}">auto</span>` : ''
    }</td>
    <td class="cell-muted">${r.schedule_day ?? '—'}</td>
    <td><button class="del-btn" data-del="${r.id}" title="Delete">×</button></td>
  </tr>`;
}

function wire(root) {
  const form = root.querySelector('#logForm');
  const errEl = root.querySelector('#logFormErr');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    const fd = new FormData(form);
    const subreddit = (fd.get('subreddit') || '').trim();
    if (!subreddit) {
      errEl.textContent = 'Subreddit is required.';
      return;
    }
    const upRaw = fd.get('upvotes');
    const dayRaw = fd.get('schedule_day');
    const me = getCurrentUser();

    const row = {
      date: fd.get('date') || todayISO(),
      who: fd.get('who'),
      subreddit,
      url: (fd.get('url') || '').trim() || null,
      type: fd.get('type'),
      upvotes: upRaw === '' ? null : Number(upRaw),
      notes: (fd.get('notes') || '').trim() || null,
      schedule_day: dayRaw === '' ? null : Number(dayRaw),
      source: 'manual',
      created_by: me,
    };

    try {
      const inserted = await addActivity(row);
      if (inserted && inserted[0]) state.activity.unshift(inserted[0]);
      renderActivityLog();
    } catch (err) {
      errEl.textContent = `Failed to add: ${err.message || err}`;
    }
  });

  root.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Delete entry?',
        message: 'This permanently removes the activity log row.',
        okLabel: 'Delete',
      });
      if (!ok) return;
      try {
        await deleteActivity(b.dataset.del);
        state.activity = state.activity.filter((x) => x.id !== b.dataset.del);
        renderActivityLog();
      } catch {
        /* error toast fired in api.js */
      }
    })
  );
}
