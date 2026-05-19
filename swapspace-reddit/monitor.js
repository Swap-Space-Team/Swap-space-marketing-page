// Continuous monitor: poll each watched sub's /new, match keywords, and write
// brand-new matches straight into Supabase `backfill_matches` (source='live').
//
// They appear in the dashboard's Backfill tab automatically (Supabase Realtime
// — usually within ~1s) in the same triage queue as CSV-imported matches.
//
// Dedupe is the table's primary key: re-seeing a post is an `on conflict do
// nothing`, so a match you've already replied to / dismissed is never
// resurrected. No Gist, no Slack.
//
//   npm run monitor               normal run (writes to Supabase)
//   npm run monitor -- --dry-run  fetch + match + count, write NOTHING
//   npm run monitor -- --seed     alias of --dry-run (back-compat)

import "dotenv/config";
import { fetchNew } from "./lib/reddit.js";
import { matchKeywords } from "./lib/match.js";
import {
  getKeywords,
  getWatchedSubreddits,
  insertLiveMatches,
} from "./lib/supabase.js";

const keywords = await getKeywords();
const subreddits = await getWatchedSubreddits();
const PER_SUB_LIMIT = 25;

const DRY = process.argv.includes("--dry-run") || process.argv.includes("--seed");

if (keywords.length === 0)
  throw new Error("No keywords in Supabase. Add some via the dashboard.");
if (subreddits.length === 0)
  throw new Error("No watched subreddits. Toggle some in the dashboard.");

console.log(
  `${DRY ? "[DRY-RUN] " : ""}Monitoring ${subreddits.length} subs with ${
    keywords.length
  } keywords → Supabase backfill_matches (source='live')`
);

const matched = [];
let scanned = 0;

for (const sub of subreddits) {
  let posts = [];
  try {
    posts = await fetchNew(sub, PER_SUB_LIMIT);
  } catch (e) {
    console.warn(`  r/${sub}: ${e.message}`);
    continue;
  }
  for (const p of posts) {
    scanned++;
    const hits = matchKeywords(`${p.title} ${p.body}`, keywords);
    if (hits.length) matched.push({ ...p, hits });
  }
}

if (DRY) {
  console.log(
    `[DRY-RUN] Scanned ${scanned} posts, ${matched.length} keyword match(es). Nothing written.`
  );
  for (const m of matched.slice(0, 20)) {
    console.log(`  • ${m.subreddit} "${m.title.slice(0, 70)}" 🔑 ${m.hits.join(", ")}`);
  }
} else {
  let inserted = 0;
  try {
    inserted = await insertLiveMatches(matched);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
  console.log(
    `Scanned ${scanned} posts, ${matched.length} matched, ${inserted} new row(s) written ` +
      `(${matched.length - inserted} already in backfill_matches).`
  );
}
