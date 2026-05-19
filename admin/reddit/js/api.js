// js/api.js — every Supabase query, grouped by table.
//
// Writes dispatch `sb:saved` (success) or `sb:error` (failure) on window so the
// header's saved-indicator can react without a circular import.

import { supabase } from './supabase-client.js';

function signalSaved() {
  window.dispatchEvent(new CustomEvent('sb:saved'));
}
function signalError(err) {
  console.error('[api] write failed:', err);
  window.dispatchEvent(new CustomEvent('sb:error', { detail: err }));
}

// Wrap a write so callers get a clean throw + the indicator fires.
async function write(promise) {
  const { data, error } = await promise;
  if (error) {
    signalError(error);
    throw error;
  }
  signalSaved();
  return data;
}

// ── app_state ───────────────────────────────────────────────────────────────

export async function getAppState(key) {
  const { data, error } = await supabase
    .from('app_state')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return data ? data.value : null;
}

export async function setAppState(key, value) {
  return write(
    supabase
      .from('app_state')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      .select()
  );
}

// Seed defaults only if absent (idempotent).
export async function ensureAppStateDefaults() {
  const { data, error } = await supabase.from('app_state').select('key');
  if (error) throw error;
  const have = new Set((data || []).map((r) => r.key));
  const rows = [];
  if (!have.has('backfill_mode')) rows.push({ key: 'backfill_mode', value: { mode: 'tuning' } });
  if (!have.has('schedule_start_date'))
    rows.push({ key: 'schedule_start_date', value: { date: '2026-05-18' } });
  if (rows.length) {
    const { error: e2 } = await supabase.from('app_state').insert(rows);
    if (e2) throw e2;
  }
}

// ── subreddits ──────────────────────────────────────────────────────────────

const SUBREDDIT_SEED = [
  ['r/fatFIRE', 'https://www.reddit.com/r/fatFIRE/', 'Reddit', 'Finance / FIRE', false],
  ['r/homeswap', 'https://www.reddit.com/r/homeswap/', 'Reddit', 'Home swap', true],
  ['r/homeexchange', 'https://www.reddit.com/r/homeexchange/', 'Reddit', 'Home swap', true],
  ['r/homeexchangebyhabiqo', 'https://www.reddit.com/r/homeexchangebyhabiqo/', 'Reddit', 'Home swap', true],
  ['r/NYCapartments', 'https://www.reddit.com/r/NYCapartments/', 'Reddit', 'Housing', false],
  ['r/KindredHomeSwap', 'https://www.reddit.com/r/KindredHomeSwap/', 'Reddit', 'Home swap', true],
  ['r/Shoestring', 'https://www.reddit.com/r/Shoestring/', 'Reddit', 'Budget travel', false],
  ['r/london', 'https://www.reddit.com/r/london/', 'Reddit', 'Location', false],
  ['r/TravelHacks', 'https://www.reddit.com/r/TravelHacks/', 'Reddit', 'Travel', true],
  ['r/ExpatFIRE', 'https://www.reddit.com/r/ExpatFIRE/', 'Reddit', 'Finance / FIRE', false],
  ['r/digitalnomad', 'https://www.reddit.com/r/digitalnomad/', 'Reddit', 'Digital nomad', true],
  ['r/travel', 'https://www.reddit.com/r/travel/', 'Reddit', 'Travel', true],
  ['r/airbnb_hosts', 'https://www.reddit.com/r/airbnb_hosts/', 'Reddit', 'Hosting', false],
  ['r/trustedhousesitters', 'https://www.reddit.com/r/trustedhousesitters/', 'Reddit', 'Home swap', true],
  ['r/UKPersonalFinance', 'https://www.reddit.com/r/UKPersonalFinance/', 'Reddit', 'Finance', false],
  ['r/sustainability', 'https://www.reddit.com/r/sustainability/', 'Reddit', 'Sustainability', false],
  ['r/expats', 'https://www.reddit.com/r/expats/', 'Reddit', 'Expat', false],
  ['Digital Nomad Accommodation', 'https://www.facebook.com/groups/325849768974770', 'Facebook', 'Digital nomad', false],
  ['Digital Nomads', 'https://www.facebook.com/groups/1033016563818566/', 'Facebook', 'Digital nomad', false],
];

export async function getSubreddits() {
  const { data, error } = await supabase.from('subreddits').select('*').order('id');
  if (error) throw error;
  return data || [];
}

export async function ensureSubredditsSeed() {
  const existing = await getSubreddits();
  if (existing.length) return existing;
  const rows = SUBREDDIT_SEED.map(([name, url, platform, category, is_watched]) => ({
    name,
    url,
    platform,
    category,
    is_watched,
  }));
  const { error } = await supabase.from('subreddits').insert(rows);
  if (error) throw error;
  return getSubreddits();
}

export async function setSubredditWatched(id, isWatched) {
  return write(
    supabase.from('subreddits').update({ is_watched: isWatched }).eq('id', id).select()
  );
}

// ── keywords ────────────────────────────────────────────────────────────────

const KEYWORD_SEED = [
  'home swap',
  'house swap',
  'home exchange',
  'swap apartment',
  'trade homes',
  'swap homes',
];

export async function getKeywords() {
  const { data, error } = await supabase.from('keywords').select('*').order('id');
  if (error) throw error;
  return data || [];
}

export async function ensureKeywordsSeed() {
  const existing = await getKeywords();
  if (existing.length) return existing;
  const { error } = await supabase
    .from('keywords')
    .insert(KEYWORD_SEED.map((keyword) => ({ keyword })));
  if (error) throw error;
  return getKeywords();
}

export async function addKeyword(keyword) {
  const k = keyword.trim();
  if (!k) throw new Error('Empty keyword');
  return write(supabase.from('keywords').insert({ keyword: k }).select());
}

export async function removeKeyword(id) {
  return write(supabase.from('keywords').delete().eq('id', id).select());
}

// ── schedule_entries ────────────────────────────────────────────────────────

export async function getScheduleEntries() {
  const { data, error } = await supabase
    .from('schedule_entries')
    .select('*')
    .order('week')
    .order('day_offset');
  if (error) throw error;
  return data || [];
}

export async function seedScheduleEntries(entries) {
  const { error } = await supabase.from('schedule_entries').insert(entries);
  if (error) throw error;
  return getScheduleEntries();
}

export async function updateScheduleEntry(id, patch, updatedBy) {
  return write(
    supabase
      .from('schedule_entries')
      .update({ ...patch, updated_by: updatedBy, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
  );
}

// ── backfill_matches ────────────────────────────────────────────────────────

export async function getMatches() {
  const { data, error } = await supabase
    .from('backfill_matches')
    .select('*')
    .order('created_utc', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Insert only ids that don't already exist. Returns { inserted, skipped }.
export async function importMatches(rows) {
  const { data: existing, error } = await supabase.from('backfill_matches').select('id');
  if (error) throw error;
  const have = new Set((existing || []).map((r) => r.id));

  // Dedupe within the incoming batch too.
  const seen = new Set();
  const fresh = [];
  let skipped = 0;
  for (const r of rows) {
    if (have.has(r.id) || seen.has(r.id)) {
      skipped++;
      continue;
    }
    seen.add(r.id);
    fresh.push(r);
  }

  let inserted = 0;
  // Chunk inserts to stay well under any payload limits.
  for (let i = 0; i < fresh.length; i += 500) {
    const chunk = fresh.slice(i, i + 500);
    const { error: e2 } = await supabase.from('backfill_matches').insert(chunk);
    if (e2) {
      signalError(e2);
      throw e2;
    }
    inserted += chunk.length;
  }
  if (inserted) signalSaved();
  return { inserted, skipped };
}

export async function clearMatches() {
  // delete-all needs a where clause; id is never empty string.
  return write(supabase.from('backfill_matches').delete().neq('id', '').select());
}

export async function updateMatch(id, patch) {
  return write(supabase.from('backfill_matches').update(patch).eq('id', id).select());
}

// ── activity_log ────────────────────────────────────────────────────────────

export async function getActivityLog() {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addActivity(row) {
  return write(supabase.from('activity_log').insert(row).select());
}

export async function deleteActivity(id) {
  return write(supabase.from('activity_log').delete().eq('id', id).select());
}
