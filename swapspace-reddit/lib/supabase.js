import { createClient } from "@supabase/supabase-js";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env."
  );
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export async function getKeywords() {
  const { data, error } = await supabase
    .from("keywords")
    .select("keyword")
    .order("id");
  if (error) throw new Error(`Supabase keywords: ${error.message}`);
  return data.map((r) => r.keyword);
}

export async function getWatchedSubreddits() {
  const { data, error } = await supabase
    .from("subreddits")
    .select("name")
    .eq("platform", "Reddit")
    .eq("is_watched", true)
    .order("id");
  if (error) throw new Error(`Supabase subreddits: ${error.message}`);
  // Strip the "r/" prefix for downstream code that expects bare names
  return data.map((r) => r.name.replace(/^r\//, ""));
}

// Upsert monitor matches into backfill_matches with source='live'.
// The id is the primary key, so `on conflict do nothing` (ignoreDuplicates)
// makes the DB itself the dedupe store — no Gist needed. Status/reviewed_*
// of an already-seen row are preserved (the conflicting insert is skipped).
// Returns the number of NEW rows actually inserted.
export async function insertLiveMatches(matches) {
  if (!matches.length) return 0;
  const rows = matches.map((m) => ({
    id: m.id, // e.g. "post_abc123" — same convention as backfill.js
    type: m.type,
    subreddit: m.subreddit,
    title: m.title || null,
    body: m.body || null,
    author: m.author || null,
    created_utc: new Date(Number(m.created_utc) * 1000).toISOString(),
    url: m.url,
    score: m.score ?? 0,
    num_comments: m.num_comments ?? 0,
    hits: m.hits,
    status: "unread",
    source: "live",
  }));

  const { data, error } = await supabase
    .from("backfill_matches")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`Supabase backfill_matches insert: ${error.message}`);
  return data ? data.length : 0;
}
