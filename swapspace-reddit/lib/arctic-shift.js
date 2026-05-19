// Arctic Shift history fetcher (https://arctic-shift.photon-reddit.com).
// Endpoints: /api/posts/search and /api/comments/search with
// subreddit + after + before + limit + sort + sort_type params.
//
// Pagination: descending by created_utc, walking `before` back to the last
// item seen, until we run out, hit `afterUnix`, or hit perSubCap.

const BASE = "https://arctic-shift.photon-reddit.com/api";
const PAGE = 100; // Arctic Shift max rows per request

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 4) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": "swapspace-backfill/1.0", Accept: "application/json" },
    });
    if (res.status === 429 || res.status >= 500) {
      const wait = 1500 * attempt;
      console.warn(`  Arctic Shift ${res.status}, retrying in ${wait}ms…`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Arctic Shift ${res.status} ${res.statusText} for ${url}`);
    }
    const json = await res.json();
    return Array.isArray(json) ? json : json.data || [];
  }
  throw new Error(`Arctic Shift failed after ${tries} attempts: ${url}`);
}

function permalink(item) {
  if (item.permalink) return `https://www.reddit.com${item.permalink}`;
  if (item.link_id) {
    const pid = String(item.link_id).replace(/^t3_/, "");
    return `https://www.reddit.com/comments/${pid}/_/${item.id}/`;
  }
  return `https://www.reddit.com/r/${item.subreddit}/comments/${item.id}/`;
}

function normalize(item, type) {
  return {
    id: `${type}_${item.id}`,
    type,
    subreddit: `r/${item.subreddit}`,
    title: type === "post" ? item.title || "" : "",
    body: type === "post" ? item.selftext || "" : item.body || "",
    author: item.author || "[deleted]",
    created_utc: Number(item.created_utc),
    url: permalink(item),
    score: typeof item.score === "number" ? item.score : 0,
    num_comments: type === "post" ? item.num_comments ?? 0 : 0,
  };
}

async function fetchType({ subreddit, type, afterUnix, beforeUnix, perSubCap }) {
  const path = type === "post" ? "posts" : "comments";
  const out = [];
  let before = beforeUnix;
  let guard = 0;

  while (out.length < perSubCap && guard < 60) {
    guard++;
    const qs = new URLSearchParams({
      subreddit,
      after: String(afterUnix),
      before: String(before),
      limit: String(PAGE),
      sort: "desc",
      sort_type: "created_utc",
    });
    const rows = await getJson(`${BASE}/${path}/search?${qs}`);
    if (!rows.length) break;

    for (const r of rows) out.push(normalize(r, type));

    const oldest = Math.min(...rows.map((r) => Number(r.created_utc)));
    if (!Number.isFinite(oldest) || oldest <= afterUnix) break;
    if (rows.length < PAGE) break;
    before = oldest - 1;
    await sleep(350); // be polite
  }
  return out.slice(0, perSubCap);
}

// Fetch history for one subreddit across the requested types.
export async function fetchSubHistory({
  subreddit,
  types = ["post"],
  afterUnix,
  beforeUnix = Math.floor(Date.now() / 1000),
  perSubCap = 200,
}) {
  let all = [];
  for (const type of types) {
    const part = await fetchType({ subreddit, type, afterUnix, beforeUnix, perSubCap });
    all = all.concat(part);
  }
  return all;
}
