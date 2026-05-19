// js/ui-subreddits.js — read-only reference list with a category filter.

import { state } from './state.js';
import { escapeHtml } from './util.js';

let activeCategory = 'All';

export function renderSubreddits() {
  const root = document.getElementById('tab-subreddits');
  const subs = state.subreddits;

  const categories = ['All', ...Array.from(new Set(subs.map((s) => s.category))).sort()];
  if (!categories.includes(activeCategory)) activeCategory = 'All';

  const visible =
    activeCategory === 'All' ? subs : subs.filter((s) => s.category === activeCategory);

  root.innerHTML = `
    <div class="filter-bar">
      <div class="filter-group">
        <span class="fg-label">Category</span>
        ${categories
          .map(
            (c) =>
              `<button class="pill-btn ${c === activeCategory ? 'active' : ''}" data-cat="${escapeHtml(
                c
              )}">${escapeHtml(c)}</button>`
          )
          .join('')}
      </div>
    </div>

    <div class="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>Subreddit / Group</th>
            <th>URL</th>
            <th>Platform</th>
            <th>Category</th>
          </tr>
        </thead>
        <tbody>
          ${
            visible.length
              ? visible
                  .map(
                    (s) => `<tr>
                      <td><strong>${escapeHtml(s.name)}</strong></td>
                      <td><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(
                        s.url
                      )}</a></td>
                      <td><span class="pill ${
                        s.platform === 'Reddit' ? 'pill-reddit' : 'pill-facebook'
                      }">${escapeHtml(s.platform)}</span></td>
                      <td>${escapeHtml(s.category)}</td>
                    </tr>`
                  )
                  .join('')
              : `<tr><td colspan="4"><div class="empty-state">No subreddits in this category.</div></td></tr>`
          }
        </tbody>
      </table>
    </div>
  `;

  root.querySelectorAll('[data-cat]').forEach((b) =>
    b.addEventListener('click', () => {
      activeCategory = b.dataset.cat;
      renderSubreddits();
    })
  );
}
