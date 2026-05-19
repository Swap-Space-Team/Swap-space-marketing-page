// Reddit OAuth "script app" flow + /new.json fetcher for the monitor.
// Create the app at https://www.reddit.com/prefs/apps (type: script).

const UA =
  process.env.REDDIT_USER_AGENT ||
  `swapspace-monitor/1.0 by u/${process.env.REDDIT_USERNAME || "unknown"}`;

let _token = null;
let _tokenExp = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExp - 30_000) return _token;

  const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD } =
    process.env;
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET || !REDDIT_USERNAME || !REDDIT_PASSWORD) {
    throw new Error("Missing Reddit OAuth env vars (CLIENT_ID/SECRET/USERNAME/PASSWORD).");
  }

  const basic = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString(
    "base64"
  );
  const body = new URLSearchParams({
    grant_type: "password",
    username: REDDIT_USERNAME,
    password: REDDIT_PASSWORD,
  });

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Reddit token request failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error(`Reddit token response had no access_token`);
  _token = json.access_token;
  _tokenExp = Date.now() + (json.expires_in || 3600) * 1000;
  return _token;
}

function normalizePost(child) {
  const d = child.data;
  return {
    id: `post_${d.id}`,
    fullname: d.name, // e.g. t3_abc123
    type: "post",
    subreddit: `r/${d.subreddit}`,
    title: d.title || "",
    body: d.selftext || "",
    author: d.author || "[deleted]",
    created_utc: Number(d.created_utc),
    url: `https://www.reddit.com${d.permalink}`,
    score: d.score ?? 0,
    num_comments: d.num_comments ?? 0,
  };
}

// Newest posts for a subreddit via the authenticated oauth endpoint.
export async function fetchNew(subreddit, limit = 25) {
  const token = await getToken();
  const res = await fetch(
    `https://oauth.reddit.com/r/${subreddit}/new?limit=${limit}&raw_json=1`,
    { headers: { Authorization: `Bearer ${token}`, "User-Agent": UA } }
  );
  if (res.status === 429) {
    console.warn(`  r/${subreddit}: rate limited (429), skipping this round`);
    return [];
  }
  if (!res.ok) {
    console.warn(`  r/${subreddit}: ${res.status} ${res.statusText}, skipping`);
    return [];
  }
  const json = await res.json();
  const children = json?.data?.children || [];
  return children.filter((c) => c.kind === "t3").map(normalizePost);
}
