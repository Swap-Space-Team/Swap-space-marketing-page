// js/ui-schedule.js — the 8-week schedule table with inline edits.

import { state } from './state.js';
import { updateScheduleEntry } from './api.js';
import { getCurrentUser } from './current-user.js';
import { globalDay } from './cycle.js';
import { formatDate, escapeHtml } from './util.js';

let whoFilter = 'All';
let actionFilter = 'All';
const debouncers = new Map();

function patchLocal(id, patch) {
  const row = state.scheduleEntries.find((e) => e.id === id);
  if (row) Object.assign(row, patch);
}

function persist(id, patch, { rerender } = {}) {
  const user = getCurrentUser();
  patchLocal(id, patch);
  updateScheduleEntry(id, patch, user)
    .then(() => {
      window.dispatchEvent(new CustomEvent('header:refresh'));
      if (rerender) renderSchedule();
    })
    .catch(() => {
      /* error toast already fired via api.js */
    });
}

function debouncedPersist(id, patch) {
  clearTimeout(debouncers.get(id));
  debouncers.set(
    id,
    setTimeout(() => persist(id, patch), 500)
  );
}

export function renderSchedule() {
  const root = document.getElementById('tab-schedule');
  let rows = [...state.scheduleEntries];

  if (whoFilter !== 'All') rows = rows.filter((r) => r.who === whoFilter);
  if (actionFilter !== 'All') rows = rows.filter((r) => r.action === actionFilter);
  rows.sort((a, b) => a.week - b.week || a.day_offset - b.day_offset);

  const pillBtns = (group, current, opts) =>
    opts
      .map(
        (o) =>
          `<button class="pill-btn ${o === current ? 'active' : ''}" data-${group}="${o}">${o}</button>`
      )
      .join('');

  root.innerHTML = `
    <div class="filter-bar">
      <div class="filter-group">
        <span class="fg-label">Who</span>
        ${pillBtns('who', whoFilter, ['All', 'Ola', 'Ezekiel', 'Both'])}
      </div>
      <div class="filter-group">
        <span class="fg-label">Action</span>
        ${pillBtns('action', actionFilter, ['All', 'Post', 'Reply', 'Browse'])}
      </div>
    </div>

    <div class="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>Wk</th><th>Day</th><th>Date</th><th>Action</th><th>Who</th>
            <th>Subreddit</th><th>URL</th><th>Notes</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length
              ? rows.map(rowHtml).join('')
              : `<tr><td colspan="9"><div class="empty-state">No entries match these filters.</div></td></tr>`
          }
        </tbody>
      </table>
    </div>
  `;

  wire(root);
}

function rowHtml(e) {
  const isBrowse = e.action === 'Browse';
  const statusClass =
    e.status === 'Done' ? 's-done' : e.status === 'Skipped' ? 's-skipped' : 's-pending';

  return `<tr>
    <td class="cell-muted">${e.week}</td>
    <td class="cell-muted">${globalDay(e.week, e.day_offset)}</td>
    <td>${formatDate(e.date)}</td>
    <td><span class="pill pill-${e.action.toLowerCase()}">${e.action}</span></td>
    <td><span class="who-${e.who.toLowerCase()}">${e.who}</span></td>
    <td>${
      isBrowse
        ? '<span class="cell-muted">—</span>'
        : `<input type="text" data-id="${e.id}" data-field="subreddit" value="${escapeHtml(
            e.subreddit || ''
          )}" placeholder="r/…" />`
    }</td>
    <td>${
      isBrowse
        ? '<span class="cell-muted">—</span>'
        : `<input type="url" data-id="${e.id}" data-field="url" value="${escapeHtml(
            e.url || ''
          )}" placeholder="https://…" />`
    }</td>
    <td class="cell-muted">${escapeHtml(e.notes || '')}</td>
    <td>${
      isBrowse
        ? '<span class="cell-muted">—</span>'
        : `<select class="status-select ${statusClass}" data-id="${e.id}" data-field="status">
            ${['Pending', 'Done', 'Skipped']
              .map(
                (s) => `<option value="${s}" ${s === e.status ? 'selected' : ''}>${s}</option>`
              )
              .join('')}
          </select>`
    }</td>
  </tr>`;
}

function wire(root) {
  root.querySelectorAll('[data-who]').forEach((b) =>
    b.addEventListener('click', () => {
      whoFilter = b.dataset.who;
      renderSchedule();
    })
  );
  root.querySelectorAll('[data-action]').forEach((b) =>
    b.addEventListener('click', () => {
      actionFilter = b.dataset.action;
      renderSchedule();
    })
  );

  root.querySelectorAll('input[data-field]').forEach((inp) => {
    inp.addEventListener('input', () =>
      debouncedPersist(inp.dataset.id, { [inp.dataset.field]: inp.value })
    );
    // flush pending debounce on blur so a quick edit + tab-away still saves
    inp.addEventListener('blur', () => {
      const id = inp.dataset.id;
      if (debouncers.has(id)) {
        clearTimeout(debouncers.get(id));
        debouncers.delete(id);
        persist(id, { [inp.dataset.field]: inp.value });
      }
    });
  });

  root.querySelectorAll('select[data-field="status"]').forEach((sel) =>
    sel.addEventListener('change', () =>
      persist(sel.dataset.id, { status: sel.value }, { rerender: true })
    )
  );
}
