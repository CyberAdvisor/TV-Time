const assert = require('assert');
const {
  sortedEpisodes, findWatchedIndex, findEpisodeIdBySeasonNumber,
  computeShowStatus, groupShows, formatCountdown, isSpecial, formatEpisodeCode,
  nextTopAvailableOrder, nextBottomAvailableOrder,
  episodesLeftInSeason, seasonsRemaining, withArchiveOverride, buildArchiveSnapshot
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

// --- groupShows: available group sorts by availableOrder (recency marker) ---
{
  const entries = [
    { show: { name: 'Old' }, status: { group: 'available', nextEpisode: {} }, availableOrder: 0 },
    { show: { name: 'JustAdded' }, status: { group: 'available', nextEpisode: {} }, availableOrder: -1 },
    { show: { name: 'JustMarkedWatched' }, status: { group: 'available', nextEpisode: {} }, availableOrder: 1 }
  ];
  const groups = groupShows(entries);
  assert.deepStrictEqual(
    groups.available.map(e => e.show.name),
    ['JustAdded', 'Old', 'JustMarkedWatched'],
    'newly-added (negative order) sorts to top, untouched (0) in the middle, just-marked-watched (positive) sorts to bottom'
  );
}

// --- nextTopAvailableOrder / nextBottomAvailableOrder ---
{
  assert.strictEqual(nextTopAvailableOrder([]), -1, 'first-ever top placement is -1 (above baseline 0)');
  assert.strictEqual(nextBottomAvailableOrder([]), 1, 'first-ever bottom placement is 1 (below baseline 0)');

  const items = [{ availableOrder: -1 }, { availableOrder: 0 }, { availableOrder: 3 }];
  assert.strictEqual(nextTopAvailableOrder(items), -2, 'top placement goes below the current minimum');
  assert.strictEqual(nextBottomAvailableOrder(items), 4, 'bottom placement goes above the current maximum');

  const untouchedItems = [{}, {}]; // no availableOrder field at all (pre-existing library items)
  assert.strictEqual(nextTopAvailableOrder(untouchedItems), -1, 'items missing availableOrder default to 0 for this calculation');
}
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

// --- episodesLeftInSeason ---
{
  const episodes = sortedEpisodes([
    { id: 1, season: 2, number: 1, airdate: '2026-01-01' },
    { id: 2, season: 2, number: 2, airdate: '2026-01-08' },
    { id: 3, season: 2, number: 3, airdate: '2026-01-15' },
    { id: 4, season: 2, number: 4, airdate: '2026-01-22' },
    { id: 5, season: 3, number: 1, airdate: '2026-06-01' }
  ]);
  assert.strictEqual(episodesLeftInSeason(episodes, episodes[1]), 3, 'next episode counts itself plus the rest of its season (S2E2, E3, E4 = 3)');
  assert.strictEqual(episodesLeftInSeason(episodes, episodes[3]), 1, 'last episode of a season counts as 1 left (itself)');
  assert.strictEqual(episodesLeftInSeason(episodes, null), 0, 'no next episode (caught up) means 0 left');
  assert.strictEqual(episodesLeftInSeason(episodes, { id: 999, season: 2 }), 0, 'an episode not found in the list returns 0 rather than throwing');
}

// --- episodesLeftInSeason: specials count toward their season's total ---
{
  const episodes = sortedEpisodes([
    { id: 8, season: 2, number: 8, airdate: '2011-11-06', name: 'Episode 8' },
    { id: 88, season: 2, number: null, airdate: '2011-12-21', name: 'Behind the Drama' },
    { id: 241, season: 2, number: null, airdate: '2011-12-25', name: 'Christmas at Downton Abbey' },
    { id: 66, season: 3, number: 1, airdate: '2012-09-16', name: 'S3E1' }
  ]);
  assert.strictEqual(episodesLeftInSeason(episodes, episodes[0]), 3, 'S2E8 plus the two season-2 specials that follow it = 3 left');
}

// --- seasonsRemaining ---
{
  const episodes = sortedEpisodes([
    { id: 1, season: 1, number: 1, airdate: '2026-01-01' },
    { id: 2, season: 2, number: 1, airdate: '2026-02-01' },
    { id: 3, season: 3, number: 1, airdate: '2026-03-01' }
  ]);
  assert.deepStrictEqual(seasonsRemaining(episodes, episodes[0]), { remaining: 2, total: 3 }, 'on season 1 of 3, seasons 2 and 3 remain');
  assert.deepStrictEqual(seasonsRemaining(episodes, episodes[2]), { remaining: 0, total: 3 }, 'on the final season, nothing remains');
  assert.deepStrictEqual(seasonsRemaining(episodes, null), { remaining: 0, total: 3 }, 'no next episode (caught up) reports 0 remaining but still the correct total');
}

// --- seasonsRemaining: single-season show ---
{
  const episodes = sortedEpisodes([
    { id: 1, season: 1, number: 1, airdate: '2026-01-01' },
    { id: 2, season: 1, number: 2, airdate: '2026-01-08' }
  ]);
  assert.deepStrictEqual(seasonsRemaining(episodes, episodes[0]), { remaining: 0, total: 1 }, 'a single-season show has 0 remaining, 1 total');
}

// --- withArchiveOverride ---
{
  const availableStatus = { group: 'available', nextEpisode: { id: 1, season: 1, number: 1 } };
  assert.deepStrictEqual(withArchiveOverride(availableStatus, false), availableStatus, 'not archived: real status passes through unchanged');
  assert.strictEqual(withArchiveOverride(availableStatus, undefined), availableStatus, 'undefined archived flag (pre-existing data) behaves as not archived');

  const archivedResult = withArchiveOverride(availableStatus, true);
  assert.strictEqual(archivedResult.group, 'completed', 'archived show always reports as completed, regardless of real status');
  assert.strictEqual(archivedResult.nextEpisode, null, 'archived show has no actionable next episode');
  assert.strictEqual(archivedResult.archived, true, 'archived flag carries through onto the returned status');

  const upcomingStatus = { group: 'upcoming', nextEpisode: { airdate: '2027-01-01' }, daysUntil: 100 };
  assert.strictEqual(withArchiveOverride(upcomingStatus, true).group, 'completed', 'even a show with a known future episode is overridden to completed once archived');
}

// --- buildArchiveSnapshot ---
{
  const episodes = sortedEpisodes([
    { id: 1, season: 1, number: 1, airdate: '2026-01-01' },
    { id: 2, season: 1, number: 2, airdate: '2026-01-08' },
    { id: 3, season: 1, number: 3, airdate: '2026-01-15' },
    { id: 4, season: 2, number: 1, airdate: '2026-06-01' }
  ]);

  const snap = buildArchiveSnapshot(episodes, 2, episodes[2]); // watched S1E2, next is S1E3
  assert.strictEqual(snap.lastWatchedCode, 'S01E02');
  assert.strictEqual(snap.episodesLeftInSeason, episodesLeftInSeason(episodes, episodes[2]), 'matches episodesLeftInSeason computed directly (S1E3 itself = 1 left)');
  assert.deepStrictEqual(snap.seasonsRemaining, seasonsRemaining(episodes, episodes[2]), 'matches seasonsRemaining computed directly (season 2 remains = 1 of 2)');

  const snapNothingWatched = buildArchiveSnapshot(episodes, null, episodes[0]);
  assert.strictEqual(snapNothingWatched.lastWatchedCode, 'Not started', 'no watched episode yet reports "Not started" rather than a bogus code');

  const snapCaughtUp = buildArchiveSnapshot(episodes, 4, null); // watched everything, no next episode
  assert.strictEqual(snapCaughtUp.lastWatchedCode, 'S02E01', 'last watched still resolves correctly even with no next episode');
  assert.strictEqual(snapCaughtUp.episodesLeftInSeason, 0, 'no next episode means 0 episodes left in season');
  assert.deepStrictEqual(snapCaughtUp.seasonsRemaining, { remaining: 0, total: 2 }, 'no next episode means 0 seasons remaining, but total is still reported');
}

console.log('All logic tests passed.');
