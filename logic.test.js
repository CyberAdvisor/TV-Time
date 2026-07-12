const assert = require('assert');
const {
  sortedEpisodes, findWatchedIndex, findEpisodeIdBySeasonNumber,
  computeShowStatus, groupShows, formatCountdown, isSpecial, formatEpisodeCode
} = require('./logic');

const TODAY = '2026-07-12';

// --- sortedEpisodes: regular episodes ---
{
  const raw = [
    { id: 2, season: 1, number: 2, airdate: '2026-01-08' },
    { id: 1, season: 1, number: 1, airdate: '2026-01-01' },
    { id: 3, season: null, number: null, airdate: '2026-01-01', name: 'no season at all - excluded' }
  ];
  const sorted = sortedEpisodes(raw);
  assert.strictEqual(sorted.length, 2, 'excludes entries with no season at all');
  assert.strictEqual(sorted[0].number, 1, 'sorts ascending by airdate');
}

// --- sortedEpisodes: specials included and positioned by airdate ---
{
  const raw = [
    { id: 1, season: 2, number: 1, airdate: '2026-01-01', name: 'S2E1' },
    { id: 2, season: 2, number: 2, airdate: '2026-01-08', name: 'S2E2' },
    { id: 3, season: 2, number: null, airdate: '2026-01-15', name: 'Christmas Special', type: 'significant_special' },
    { id: 4, season: 3, number: 1, airdate: '2026-02-01', name: 'S3E1' }
  ];
  const sorted = sortedEpisodes(raw);
  assert.strictEqual(sorted.length, 4, 'specials are no longer dropped');
  assert.strictEqual(sorted[2].name, 'Christmas Special', 'special slots into its correct chronological position');
  assert.ok(isSpecial(sorted[2]), 'isSpecial correctly identifies number:null episodes');
  assert.strictEqual(sorted[3].name, 'S3E1', 'season 3 premiere still comes after the special, by date');
}

// --- formatEpisodeCode ---
{
  assert.strictEqual(formatEpisodeCode({ season: 4, number: 3 }), 'S04E03');
  assert.strictEqual(formatEpisodeCode({ season: 2, number: null }), 'S02 Special');
}

// --- findWatchedIndex: matches by unique id, not season/number ---
{
  const episodes = [
    { id: 101, season: 1, number: 1 },
    { id: 102, season: 1, number: 2 },
    { id: 103, season: 1, number: 3 }
  ];
  assert.strictEqual(findWatchedIndex(episodes, 102), 1);
  assert.strictEqual(findWatchedIndex(episodes, null), -1, 'no watched id means -1 (start from episode 0)');
  assert.strictEqual(findWatchedIndex(episodes, 999), -1, 'unmatched id');
}

// --- findEpisodeIdBySeasonNumber: resolves user-entered season/number to an id ---
{
  const episodes = [
    { id: 101, season: 1, number: 1 },
    { id: 102, season: 1, number: 2 }
  ];
  assert.strictEqual(findEpisodeIdBySeasonNumber(episodes, 1, 2), 102);
  assert.strictEqual(findEpisodeIdBySeasonNumber(episodes, 9, 9), null, 'no match returns null');
}

// --- THE ACTUAL REPORTED BUG: two specials in the same season both have
// season set + number:null (real TVmaze data for Downton Abbey S2: "Behind
// the Drama" and "Christmas at Downton Abbey" are both season:2, number:null).
// Matching on season+number collapses them into one identifier, so marking
// the second one watched looks like a no-op. Matching on id fixes this. ---
{
  const episodes = sortedEpisodes([
    { id: 8, season: 2, number: 8, airdate: '2011-11-06', name: 'Episode 8' },
    { id: 88, season: 2, number: null, airdate: '2011-12-21', name: 'Behind the Drama' },
    { id: 241, season: 2, number: null, airdate: '2011-12-25', name: 'Christmas at Downton Abbey' },
    { id: 66, season: 3, number: 1, airdate: '2012-09-16', name: 'S3E1' }
  ]);

  const watchedId = findEpisodeIdBySeasonNumber(episodes, 2, 8);
  let status = computeShowStatus({ status: 'Ended' }, episodes, watchedId, TODAY);
  assert.strictEqual(status.nextEpisode.name, 'Behind the Drama', 'first special after S2E8 is Behind the Drama (earlier airdate)');

  let newWatchedId = status.nextEpisode.id;
  status = computeShowStatus({ status: 'Ended' }, episodes, newWatchedId, TODAY);
  assert.strictEqual(status.nextEpisode.name, 'Christmas at Downton Abbey', 'advances correctly to the second special');

  newWatchedId = status.nextEpisode.id;
  status = computeShowStatus({ status: 'Ended' }, episodes, newWatchedId, TODAY);
  assert.strictEqual(status.nextEpisode.name, 'S3E1', 'REGRESSION CHECK: marking the second special watched correctly advances to season 3, not stuck in place');
}

// --- computeShowStatus: available now (already aired) ---
{
  const episodes = [
    { id: 1, season: 1, number: 1, airdate: '2026-07-01' },
    { id: 2, season: 1, number: 2, airdate: '2026-07-08' }
  ];
  const status = computeShowStatus({ status: 'Running' }, episodes, 1, TODAY);
  assert.strictEqual(status.group, 'available');
  assert.strictEqual(status.nextEpisode.number, 2);
}

// --- computeShowStatus: upcoming (future airdate) ---
{
  const episodes = [
    { id: 1, season: 1, number: 1, airdate: '2026-07-01' },
    { id: 2, season: 1, number: 2, airdate: '2026-07-16' }
  ];
  const status = computeShowStatus({ status: 'Running' }, episodes, 1, TODAY);
  assert.strictEqual(status.group, 'upcoming');
  assert.strictEqual(status.daysUntil, 4, 'July 12 -> July 16 is 4 days');
}

// --- computeShowStatus: nothing watched yet -> next is episode 0 ---
{
  const episodes = [
    { id: 1, season: 1, number: 1, airdate: '2026-06-01' },
    { id: 2, season: 1, number: 2, airdate: '2026-06-08' }
  ];
  const status = computeShowStatus({ status: 'Running' }, episodes, null, TODAY);
  assert.strictEqual(status.nextEpisode.number, 1, 'unwatched show starts at episode 1');
  assert.strictEqual(status.group, 'available', 'already-aired episode 1 is available now');
}

// --- computeShowStatus: caught up, still running -> pending return ---
{
  const episodes = [
    { id: 1, season: 1, number: 1, airdate: '2026-06-01' },
    { id: 2, season: 1, number: 2, airdate: '2026-06-08' }
  ];
  const status = computeShowStatus({ status: 'Running' }, episodes, 2, TODAY);
  assert.strictEqual(status.group, 'pending');
  assert.strictEqual(status.nextEpisode, null);
}

// --- computeShowStatus: caught up, series ended -> completed ---
{
  const episodes = [{ id: 1, season: 1, number: 1, airdate: '2026-06-01' }];
  const status = computeShowStatus({ status: 'Ended' }, episodes, 1, TODAY);
  assert.strictEqual(status.group, 'completed');
}

// --- computeShowStatus: "am I on S4E3" semantics -> S4E3 itself is next up, not watched ---
{
  const episodes = [
    { id: 1, season: 4, number: 1, airdate: '2026-01-01' },
    { id: 2, season: 4, number: 2, airdate: '2026-01-08' },
    { id: 3, season: 4, number: 3, airdate: '2026-01-15' },
    { id: 4, season: 4, number: 4, airdate: '2026-01-22' }
  ];
  const watchedId = findEpisodeIdBySeasonNumber(episodes, 4, 2);
  const status = computeShowStatus({ status: 'Running' }, episodes, watchedId, TODAY);
  assert.strictEqual(status.nextEpisode.number, 3, 'entering "S4E3" surfaces S4E3 as next, not S4E4');
}

// --- groupShows: buckets and upcoming sort order ---
{
  const entries = [
    { show: { name: 'A' }, status: { group: 'upcoming', nextEpisode: { airdate: '2026-08-01' } } },
    { show: { name: 'B' }, status: { group: 'available', nextEpisode: {} } },
    { show: { name: 'C' }, status: { group: 'upcoming', nextEpisode: { airdate: '2026-07-15' } } },
    { show: { name: 'D' }, status: { group: 'pending', nextEpisode: null } }
  ];
  const groups = groupShows(entries);
  assert.strictEqual(groups.available.length, 1);
  assert.strictEqual(groups.upcoming.length, 2);
  assert.strictEqual(groups.upcoming[0].show.name, 'C', 'soonest upcoming airdate sorts first');
  assert.strictEqual(groups.pending.length, 1);
}

// --- groupShows: pending and completed sort alphabetically by show name ---
{
  const entries = [
    { show: { name: 'Zebra Show' }, status: { group: 'pending', nextEpisode: null } },
    { show: { name: 'Apple Show' }, status: { group: 'pending', nextEpisode: null } },
    { show: { name: 'Mango Show' }, status: { group: 'pending', nextEpisode: null } },
    { show: { name: 'Zima Blue' }, status: { group: 'completed', nextEpisode: null } },
    { show: { name: 'Alpha Show' }, status: { group: 'completed', nextEpisode: null } }
  ];
  const groups = groupShows(entries);
  assert.deepStrictEqual(
    groups.pending.map(e => e.show.name),
    ['Apple Show', 'Mango Show', 'Zebra Show'],
    'pending group is sorted alphabetically'
  );
  assert.deepStrictEqual(
    groups.completed.map(e => e.show.name),
    ['Alpha Show', 'Zima Blue'],
    'completed group is sorted alphabetically'
  );
}

// --- formatCountdown ---
{
  assert.strictEqual(formatCountdown(0, TODAY), 'Today');
  assert.strictEqual(formatCountdown(1, '2026-07-13'), 'Tomorrow');
  assert.ok(formatCountdown(3, '2026-07-15').includes('3 days'));
  assert.ok(formatCountdown(30, '2026-08-11').match(/Aug/), 'far-future dates show a calendar date, not a day count');
}

console.log('All logic tests passed.');
