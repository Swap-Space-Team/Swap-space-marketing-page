// One-shot backfill: pull ~90 days of history from Arctic Shift for every
// watched subreddit, keep items matching configured keywords, write a CSV the
// dashboard's "Import CSV" button understands.
//
// Config (keywords + watched subs) comes from Supabase — the same rows the
// dashboard writes. Edit them in the dashboard, not here.

import fs from "node:fs";
import "dotenv/config";
import { fetchSubHistory } from "./lib/arctic-shift.js";
import { matchKeywords } from "./lib/match.js";
import { getKeywords, getWatchedSubreddits } from "./lib/supabase.js";

const keywords = await getKeywords();
const subreddits = await getWatchedSubreddits();
const DAYS = 90;
const PER_SUB_CAP = 200;
const INCLUDE_COMMENTS = true;

if (keywords.length === 0)
  throw new Error("No keywords in Supabase. Add some via the dashboard.");
if (subreddits.length === 0)
  throw new Error("No watched subreddits. Toggle some in the dashboard.");

const afterUnix = Math.floor(Date.now() / 1000) - DAYS * 86400;
const matchFn = (text) => matchKeywords(text, keywords);
const types = INCLUDE_COMMENTS ? ["post", "comment"] : ["post"];

console.log(
  `Backfilling ${DAYS}d across ${subreddits.length} subs (${types.join(
    "+"
  )}) with ${keywords.length} keywords...`
);

// ── Fetch + match loop ──────────────────────────────────────────────────────

const matched = [];
const seenIds = new Set();

for (const sub of subreddits) {
  process.stdout.write(`  r/${sub} … `);
  let items = [];
  try {
    items = await fetchSubHistory({
      subreddit: sub,
      types,
      afterUnix,
      perSubCap: PER_SUB_CAP,
    });
  } catch (e) {
    console.log(`error: ${e.message}`);
    continue;
  }

  let hitCount = 0;
  for (const it of items) {
    const hits = matchFn(`${it.title} ${it.body}`);
    if (!hits.length) continue;
    if (seenIds.has(it.id)) continue;
    seenIds.add(it.id);
    matched.push({ ...it, hits });
    hitCount++;
  }
  console.log(`${items.length} fetched, ${hitCount} matched`);
}

matched.sort((a, b) => b.created_utc - a.created_utc);

// ── CSV write ───────────────────────────────────────────────────────────────
// Header must match the dashboard's expected import shape exactly.

const HEADER = [
  "id",
  "type",
  "subreddit",
  "title",
  "body",
  "author",
  "created_iso",
  "url",
  "score",
  "num_comments",
  "hits",
  "status",
];

function cell(v) {
  // Collapse newlines to spaces so every record is one physical line.
  const s = String(v == null ? "" : v).replace(/[\r\n]+/g, " ");
  return `"${s.replace(/"/g, '""')}"`;
}

const lines = [HEADER.join(",")];
for (const m of matched) {
  lines.push(
    [
      m.id,
      m.type,
      m.subreddit,
      m.title || "",
      m.body || "",
      m.author || "",
      new Date(m.created_utc * 1000).toISOString(),
      m.url,
      m.score ?? 0,
      m.num_comments ?? 0,
      m.hits.join("; "),
      "unread",
    ]
      .map(cell)
      .join(",")
  );
}

const date = new Date().toISOString().slice(0, 10);
const file = `backfill-${date}.csv`;
fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");

console.log(
  `\nWrote ${matched.length} matched ${
    matched.length === 1 ? "row" : "rows"
  } to ${file}`
);
console.log("Import it via the dashboard → Backfill tab → Import CSV.");
