// Case-insensitive substring keyword matcher. Returns the list of keywords
// found in `text` (in the order the keywords were configured). Same matching
// semantics the dashboard uses for highlighting.

export function matchKeywords(text, keywords) {
  if (!text) return [];
  const haystack = String(text).toLowerCase();
  const hits = [];
  for (const kw of keywords) {
    const needle = String(kw).toLowerCase().trim();
    if (needle && haystack.includes(needle)) hits.push(kw);
  }
  return hits;
}
