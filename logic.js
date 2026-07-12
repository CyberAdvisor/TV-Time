// Pure logic functions for the show tracker. Kept separate from DOM/fetch code
// so they can be unit tested in isolation before being embedded in the app.

// Includes both regular episodes and specials (which have season set but
// number: null in TVmaze's data). Sorted chronologically by airdate so
// specials slot into their real broadcast position. Episodes with no
// airdate at all can't be placed in time, so they sort to the end grouped
// by season/number as a fallback.
function sortedEpisodes(rawEpisodes) {
  return rawEpisodes
    .filter(e => e.season != null)
    .slice()
    .sort((a, b) => {
      if (a.airdate && b.airdate) {
        if (a.airdate !== b.airdate) return a.airdate.localeCompare(b.airdate);
        // same-day tiebreak: numbered episodes by number, specials last
        return (a.number ?? Infinity) - (b.number ?? Infinity);
      }
      if (a.airdate && !b.airdate) return -1;
      if (!a.airdate && b.airdate) return 1;
      return a.season - b.season || (a.number ?? Infinity) - (b.number ?? Infinity);
    });
}

function isSpecial(episode) {
  return episode.number == null;
}

function formatEpisodeCode(episode) {
  const s = String(episode.season).padStart(2, '0');
  if (isSpecial(episode)) return 'S' + s + ' Special';
  return 'S' + s + 'E' + String(episode.number).padStart(2, '0');
}

function findWatchedIndex(episodes, watchedEpisodeId) {
  if (watchedEpisodeId == null) return -1;
  return episodes.findIndex(e => e.id === watchedEpisodeId);
}

// Resolves a user-entered season/number (only ever used for regular episodes,
// since specials aren't nameable this way) to the episode's unique id.
// Regular episode numbers are unique within a season, so this is always
// unambiguous, unlike matching on season+number for specials.
function findEpisodeIdBySeasonNumber(episodes, season, number) {
  const match = episodes.find(e => e.season === season && e.number === number);
  return match ? match.id : null;
}

// today: 'YYYY-MM-DD' string, defaults to system date if omitted
function computeShowStatus(show, episodes, watchedEpisodeId, today) {
  today = today || new Date().toISOString().slice(0, 10);
  const watchedIdx = findWatchedIndex(episodes, watchedEpisodeId);
  const nextIdx = watchedIdx + 1;

  if (nextIdx >= episodes.length) {
    if (show.status === 'Ended') {
      return { group: 'completed', nextEpisode: null };
    }
    return { group: 'pending', nextEpisode: null };
  }

  const nextEpisode = episodes[nextIdx];

  if (!nextEpisode.airdate) {
    return { group: 'pending', nextEpisode };
  }

  if (nextEpisode.airdate <= today) {
    return { group: 'available', nextEpisode };
  }

  const daysUntil = Math.round(
    (new Date(nextEpisode.airdate + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000
  );
  return { group: 'upcoming', nextEpisode, daysUntil };
}

// Sort order within each group: available/completed order doesn't matter much,
// but upcoming should be soonest-first.
function sortWithinGroup(entries, group) {
  if (group === 'upcoming') {
    return entries.slice().sort((a, b) => a.status.nextEpisode.airdate.localeCompare(b.status.nextEpisode.airdate));
  }
  return entries;
}

function groupShows(showsWithStatus) {
  const groups = { available: [], upcoming: [], pending: [], completed: [] };
  for (const entry of showsWithStatus) {
    groups[entry.status.group].push(entry);
  }
  groups.upcoming = sortWithinGroup(groups.upcoming, 'upcoming');
  return groups;
}

function formatCountdown(daysUntil, airdate) {
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  if (daysUntil <= 6) {
    const d = new Date(airdate + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short' }) + ', ' + daysUntil + ' days';
  }
  const d = new Date(airdate + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

module.exports = {
  sortedEpisodes,
  findWatchedIndex,
  findEpisodeIdBySeasonNumber,
  computeShowStatus,
  groupShows,
  formatCountdown,
  isSpecial,
  formatEpisodeCode
};
