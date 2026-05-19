// js/csv.js — CSV parse + export for backfill matches.
//
// Producer (Node backfill.js) header:
//   id,type,subreddit,title,body,author,created_iso,url,score,num_comments,hits,status
// Quoted fields use "" to escape a literal ". Newlines in fields are already
// collapsed to spaces by the producer, so every record is one physical line —
// but the parser below tolerates embedded newlines anyway.

// Tokenize a full CSV string into rows of string cells (RFC-4180-ish).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const s = text.replace(/^﻿/, ''); // strip BOM

  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // flush trailing field/row if file doesn't end with newline
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const EXPECTED_HEADER = [
  'id',
  'type',
  'subreddit',
  'title',
  'body',
  'author',
  'created_iso',
  'url',
  'score',
  'num_comments',
  'hits',
  'status',
];

// Parse a backfill CSV string into backfill_matches insert rows.
// Throws on a malformed header. Skips structurally broken / empty lines.
export function parseBackfillCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('CSV is empty');

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {};
  EXPECTED_HEADER.forEach((col) => {
    idx[col] = header.indexOf(col);
  });
  const missing = EXPECTED_HEADER.filter((c) => idx[c] === -1);
  if (missing.length) {
    throw new Error(`CSV header missing column(s): ${missing.join(', ')}`);
  }

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.length === 1 && cells[0].trim() === '') continue; // blank line
    const get = (col) => (cells[idx[col]] ?? '').trim();

    const id = get('id');
    if (!id) continue;

    const createdIso = get('created_iso');
    const created = new Date(createdIso);
    const hits = get('hits')
      .split(';')
      .map((h) => h.trim())
      .filter(Boolean);

    const type = get('type').toLowerCase() === 'comment' ? 'comment' : 'post';
    let status = get('status').toLowerCase();
    if (!['unread', 'replied', 'dismissed'].includes(status)) status = 'unread';

    out.push({
      id,
      type,
      subreddit: get('subreddit'),
      title: get('title') || null,
      body: get('body') || null,
      author: get('author') || null,
      created_utc: isNaN(created.getTime()) ? new Date().toISOString() : created.toISOString(),
      url: get('url'),
      score: parseInt(get('score'), 10) || 0,
      num_comments: parseInt(get('num_comments'), 10) || 0,
      hits: hits.length ? hits : ['(unknown)'],
      status,
      source: 'backfill', // CSV imports are 'backfill'; the monitor writes 'live'
    });
  }
  return out;
}

// ── Export ──────────────────────────────────────────────────────────────────

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  // Collapse newlines to spaces (matches producer behaviour), then quote.
  const flat = s.replace(/[\r\n]+/g, ' ');
  return `"${flat.replace(/"/g, '""')}"`;
}

// Serialize backfill_matches rows back to the producer's CSV shape.
export function matchesToCsv(matches) {
  const lines = [EXPECTED_HEADER.join(',')];
  for (const m of matches) {
    const created = m.created_utc ? new Date(m.created_utc).toISOString() : '';
    lines.push(
      [
        m.id,
        m.type,
        m.subreddit,
        m.title || '',
        m.body || '',
        m.author || '',
        created,
        m.url,
        m.score ?? 0,
        m.num_comments ?? 0,
        Array.isArray(m.hits) ? m.hits.join('; ') : m.hits || '',
        m.status,
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return lines.join('\n');
}

export function downloadCsv(filename, csvString) {
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
