// js/cycle.js — the fixed 8-day rotating cycle + schedule generation.

export const CYCLE = [
  { dayOffset: 0, action: 'Post',   who: 'Ezekiel', notes: 'Choose a subreddit to post in' },
  { dayOffset: 1, action: 'Browse', who: 'Both',    notes: 'Find aged posts (2–6 weeks old) to reply to' },
  { dayOffset: 2, action: 'Browse', who: 'Both',    notes: 'Find aged posts (2–6 weeks old) to reply to' },
  { dayOffset: 3, action: 'Reply',  who: 'Ola',     notes: "Reply to Ezekiel's Day 0 post" },
  { dayOffset: 4, action: 'Post',   who: 'Ola',     notes: 'Choose a subreddit to post in' },
  { dayOffset: 5, action: 'Browse', who: 'Both',    notes: 'Find aged posts (2–6 weeks old) to reply to' },
  { dayOffset: 6, action: 'Browse', who: 'Both',    notes: 'Find aged posts (2–6 weeks old) to reply to' },
  { dayOffset: 7, action: 'Reply',  who: 'Ezekiel', notes: "Reply to Ola's Day 4 post" },
];

export const WEEKS = 8; // generate 8 weeks (64 rows total)

// Add `days` calendar days to an ISO yyyy-mm-dd date string (UTC-safe).
function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// Generate all 64 schedule rows from a start date + the cycle pattern.
// id format is "weekN-dayM" e.g. "1-0", "2-3" (week is 1-based, dayOffset 0..7).
// Browse rows have no actionable status, so they seed as '—'.
export function generateScheduleEntries(startDateISO) {
  const entries = [];
  for (let week = 1; week <= WEEKS; week++) {
    const weekIdx = week - 1;
    for (const c of CYCLE) {
      const globalDay = weekIdx * 8 + c.dayOffset;
      entries.push({
        id: `${week}-${c.dayOffset}`,
        week,
        day_offset: c.dayOffset,
        date: addDays(startDateISO, globalDay),
        action: c.action,
        who: c.who,
        notes: c.notes,
        subreddit: '',
        url: '',
        status: c.action === 'Browse' ? '—' : 'Pending',
      });
    }
  }
  return entries;
}

// globalDay shown in the "Day" column = weekIdx * 8 + dayOffset.
export function globalDay(week, dayOffset) {
  return (week - 1) * 8 + dayOffset;
}
