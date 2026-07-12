# Context for Claude: "My Shows" TV tracker

Paste this into a new conversation before asking for changes. It exists so a fresh conversation doesn't have to rediscover the gotchas below the hard way.

## What this is

A single-file HTML/CSS/vanilla-JS app (`index.html`, no build step, no framework) that tracks TV shows and tells the user what episode to watch next. Data comes from the free [TVmaze API](https://www.tvmaze.com/api) (no key required). Built for a non-technical daily-use case: simple, readable on iPhone, no flashy design.

## Data model

Each library item (persisted to `localStorage` under the key `my-shows-library-v1`) looks like:

```js
{
  showId: 251,              // TVmaze show id
  platform: "Hulu",         // free-text, user-entered
  watchedEpisodeId: 20865,  // TVmaze's unique episode id, or null if nothing watched yet
  pendingSeasonNumber: { season: 2, number: 8 }  // transient; see below
}
```

### Why `watchedEpisodeId`, not season/number

**This was a real bug, found and fixed.** The original implementation tracked "last watched" as `{season, number}`. That broke because **some shows have multiple specials in the same season that all share `season: X, number: null`** (real example: Downton Abbey season 2 has both "Behind the Drama" and "Christmas at Downton Abbey," both `season: 2, number: null`). Matching on season+number made those two episodes indistinguishable — marking the second one watched produced the same identifier as the first, so the app couldn't tell they'd advanced, and "Mark watched" appeared to silently do nothing.

**Fix:** track progress by the episode's unique TVmaze `id` instead. `season`/`number` is only used once, transiently, to resolve a user's typed-in "last watched season/episode" (via `pendingSeasonNumber`) into a concrete `id` on first load — after that, everything is id-based. See `findEpisodeIdBySeasonNumber` and `findWatchedIndex` in `logic.js`.

If you ever see code reintroducing `{season, number}` as a persistent watched-marker, that's regressing this bug — don't do it. There's a regression test for this exact scenario in `app.test.js` (`testDuplicateSpecialsRegression`).

## TVmaze API gotchas

- **`?embed=episodes` silently excludes specials.** This is documented TVmaze behavior, not a bug on our end. To get specials, you must call the separate endpoint `/shows/:id/episodes?specials=1`. The app fetches show info and episodes as two parallel calls (see `fetchShowWithEpisodes`), not the single-call `embed=episodes` shortcut.
- Specials have `number: null` but do have `season` set (usually). They're sorted into the episode sequence by `airdate`, not by season/number, so they land in their real broadcast position (see `sortedEpisodes`).
- The search endpoint (`/search/shows?q=`) is separate and unaffected by any of this.

## Hosting requirement: must be served over https, not opened as a local file

**iOS Safari blocks `fetch()` to remote APIs when the page is loaded via `file://`.** Desktop Safari tolerates this; iOS does not — confirmed via testing (error was `TypeError: Load failed`, occurring on every request, only on iPhone). This is why the app is deployed via GitHub Pages rather than just shared as a downloaded `.html` file. If you're testing changes, test them from an actual https URL if the change touches network requests, not just by opening the file locally on a phone.

## Storage

Plain `localStorage`, not any Claude/Artifact storage API — this file is meant to run standalone outside of Claude's own environment, so `window.storage` (the Claude-artifact-only persistence API) is not available and must not be used. (An earlier version mistakenly used it, which is why the app showed a blank screen originally — worth knowing in case that mistake is tempting to reintroduce for a "cleaner" API.)

## UI/rendering note: don't rebuild the search input while the user is typing

The add-show search input is deliberately kept in a stable DOM container (`#search-results-container` is updated separately from the `<input>` itself — see `updateSearchResults()` vs `renderAdd()`). Rebuilding/replacing the `<input>` element on every keystroke's search results caused iOS Safari to drop keyboard focus mid-typing. If you touch the add-show screen, preserve this separation — don't collapse it back into one `root.innerHTML = ...` render on every `oninput`.

## Testing

- `logic.js` — pure functions (sorting, status computation, grouping, id resolution), no DOM/fetch dependencies.
- `logic.test.js` — plain Node unit tests for `logic.js`. Run with `node logic.test.js`.
- `app.test.js` — integration tests that load the actual `index.html` into `jsdom`, mock `fetch`/`localStorage`, and simulate real user flows (add show, mark watched, search, error states). Run with `node app.test.js` (requires `jsdom`: `npm install jsdom`).

If you make a change, run both test files, and add a test for whatever you changed before considering it done — several of the existing tests exist specifically because a first attempt at a fix looked right but wasn't (see the specials/id-matching bug above).

## Design constraints (user preference, stated explicitly)

- Simple, no flashy graphics, easy to read on iPhone.
- No opinions/commentary injected into responses beyond what's asked.
- Test that code works before presenting it.
