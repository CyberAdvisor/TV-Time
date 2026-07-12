const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// --- Mock TVmaze responses ---
const mockShowInfo = {
  id: 501, name: 'The Bear', status: 'Running', premiered: '2022-06-23',
  network: { name: 'FX' }, image: { medium: 'https://example.com/bear.jpg' }
};
const mockShowEpisodes = [
  { id: 1001, season: 4, number: 1, name: 'Ready', airdate: '2026-06-11', runtime: 30, summary: '<p>Season opener.</p>' },
  { id: 1002, season: 4, number: 2, name: 'Sundae', airdate: '2026-06-18', runtime: 31, summary: '<p>Ep 2.</p>' },
  { id: 1003, season: 4, number: 3, name: 'Doors', airdate: '2026-06-25', runtime: 32, summary: '<p>Ep 3.</p>' },
  { id: 1004, season: 4, number: 4, name: 'Future', airdate: '2026-08-20', runtime: 30, summary: '<p>Ep 4.</p>' }
];

// A second show reproducing the EXACT reported bug: real Downton Abbey S2
// data, where "Behind the Drama" and "Christmas at Downton Abbey" both have
// season:2, number:null. Marking the second one watched via the real UI
// must actually advance the show, not silently no-op.
const mockDowntonInfo = {
  id: 251, name: 'Downton Abbey', status: 'Ended', premiered: '2010-09-26',
  network: { name: 'ITV1' }, image: { medium: 'https://example.com/downton.jpg' }
};
const mockDowntonEpisodes = [
  { id: 20864, season: 2, number: 7, name: 'Episode 7', airdate: '2011-10-30', runtime: 75, summary: '<p>Ep 7.</p>' },
  { id: 20865, season: 2, number: 8, name: 'Episode 8', airdate: '2011-11-06', runtime: 90, summary: '<p>Ep 8.</p>' },
  { id: 20888, season: 2, number: null, name: 'Behind the Drama', airdate: '2011-12-21', runtime: 60, summary: '<p>Documentary.</p>' },
  { id: 623241, season: 2, number: null, name: 'Christmas at Downton Abbey', airdate: '2011-12-25', runtime: 120, summary: '<p>Christmas special.</p>' },
  { id: 20866, season: 3, number: 1, name: 'Episode 1', airdate: '2012-09-16', runtime: 90, summary: '<p>S3 opener.</p>' }
];

const mockSearchResults = [
  { score: 10, show: { id: 501, name: 'The Bear', premiered: '2022-06-23', network: { name: 'FX' }, image: { medium: 'x.jpg' } } }
];

function mockFetch(url) {
  if (url.startsWith('https://api.tvmaze.com/search/shows')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSearchResults) });
  }
  if (url === 'https://api.tvmaze.com/shows/501') {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockShowInfo) });
  }
  if (url === 'https://api.tvmaze.com/shows/501/episodes?specials=1') {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockShowEpisodes) });
  }
  if (url === 'https://api.tvmaze.com/shows/251') {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockDowntonInfo) });
  }
  if (url === 'https://api.tvmaze.com/shows/251/episodes?specials=1') {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockDowntonEpisodes) });
  }
  return Promise.reject(new Error('unexpected fetch: ' + url));
}

function freezeDate(window, iso) {
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) return new RealDate(iso);
      return new RealDate(...args);
    }
    static now() { return new RealDate(iso).getTime(); }
  }
  window.Date = FixedDate;
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function testMainFlow() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.com' });
  const { window } = dom;
  freezeDate(window, '2026-07-12T12:00:00');
  const storageBackend = window.localStorage;
  window.fetch = (url) => mockFetch(url);

  const scriptBody = html.match(/<script>([\s\S]*)<\/script>/)[1];
  window.eval(scriptBody);
  await wait(20);

  let emptyMsg = window.document.querySelector('.empty');
  assert.ok(emptyMsg, 'shows empty state with no shows in library');

  window.document.getElementById('add-btn').click();
  await wait(10);

  const searchInput = window.document.getElementById('search-input');
  searchInput.value = 'The Bear';
  searchInput.oninput({ target: searchInput });
  await wait(400);

  const resultNode = window.document.querySelector('.search-result[data-id="501"]');
  assert.ok(resultNode, 'search result for The Bear rendered');
  resultNode.click();
  await wait(10);

  window.document.getElementById('platform-input').value = 'Hulu';
  window.document.getElementById('platform-input').oninput({ target: window.document.getElementById('platform-input') });
  window.document.getElementById('season-input').value = '4';
  window.document.getElementById('season-input').oninput({ target: window.document.getElementById('season-input') });
  window.document.getElementById('episode-input').value = '2';
  window.document.getElementById('episode-input').oninput({ target: window.document.getElementById('episode-input') });

  window.document.getElementById('submit-add-btn').click();
  await wait(50);

  let rowTitle = window.document.querySelector('.row-title');
  assert.ok(rowTitle.innerHTML.includes('The Bear'), 'show appears in list');
  assert.ok(rowTitle.innerHTML.includes('Hulu'), 'platform shown next to show name on list screen');

  let sectionLabel = window.document.querySelector('.section-label');
  assert.strictEqual(sectionLabel.textContent, 'Available now', 'S4E3 already aired -> grouped as available now');

  let rowSub = window.document.querySelector('.row-sub');
  assert.ok(rowSub.textContent.includes('S04E03'), 'entering S4E2 watched surfaces S4E3 next');
  assert.ok(rowSub.textContent.includes('Doors'), 'episode title shown');

  window.document.getElementById('row-501').click();
  await wait(10);
  assert.ok(window.document.querySelector('h1').textContent.includes('The Bear'), 'detail view shows show name');
  const platformLine = [...window.document.querySelectorAll('p')].find(p => p.textContent === 'Hulu');
  assert.ok(platformLine, 'platform displayed on detail screen too');
  const synopsis = window.document.querySelector('.synopsis');
  assert.ok(synopsis.textContent.includes('Ep 3'), 'HTML stripped from synopsis and shown correctly');

  window.document.getElementById('mark-watched-btn').click();
  await wait(10);
  let subLine = window.document.querySelector('.row-sub');
  assert.ok(subLine.textContent.includes('S04E04'), 'after marking watched, detail advances to next episode S4E4');

  const detailTable = window.document.querySelector('.detail-table');
  assert.ok(detailTable.textContent.includes('Aug 20, 2026'), 'air date formatted correctly for future episode');

  window.document.getElementById('back-btn').click();
  await wait(10);
  sectionLabel = window.document.querySelector('.section-label');
  assert.strictEqual(sectionLabel.textContent, 'Upcoming', 'S4E4 (future date) moves show to Upcoming');
  assert.ok(window.document.body.textContent.match(/Aug 20/), 'countdown/date shown in list for upcoming episode');

  const persisted = JSON.parse(storageBackend.getItem('my-shows-library-v1'));
  assert.strictEqual(persisted.length, 1);
  assert.strictEqual(persisted[0].watchedEpisodeId, 1003, 'watched progress persisted as the unique episode id for S4E3, not season/number');
  assert.strictEqual(persisted[0].platform, 'Hulu', 'platform persisted correctly');

  window.document.getElementById('row-501').click();
  await wait(10);
  window.document.getElementById('remove-link').click();
  await wait(10);
  emptyMsg = window.document.querySelector('.empty');
  assert.ok(emptyMsg, 'back to empty state after removing the only show');
  assert.strictEqual(JSON.parse(storageBackend.getItem('my-shows-library-v1')).length, 0, 'removal persisted to storage');

  console.log('testMainFlow passed.');
}

async function testDuplicateSpecialsRegression() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.com' });
  const { window } = dom;
  freezeDate(window, '2026-07-12T12:00:00');
  const storageBackend = window.localStorage;
  window.fetch = (url) => mockFetch(url);

  storageBackend.setItem('my-shows-library-v1', JSON.stringify([
    { showId: 251, platform: 'Peacock', watchedEpisodeId: null, pendingSeasonNumber: { season: 2, number: 8 } }
  ]));

  const scriptBody = html.match(/<script>([\s\S]*)<\/script>/)[1];
  window.eval(scriptBody);
  await wait(50);

  let rowSub = window.document.querySelector('.row-sub');
  assert.ok(rowSub.textContent.includes('Behind the Drama'), 'first special after S2E8 is Behind the Drama');

  window.document.getElementById('mark-251').click();
  await wait(10);

  rowSub = window.document.querySelector('.row-sub');
  assert.ok(rowSub.textContent.includes('Christmas at Downton Abbey'), 'advances to the second special after marking the first one watched');

  window.document.getElementById('mark-251').click();
  await wait(10);

  rowSub = window.document.querySelector('.row-sub');
  assert.ok(rowSub.textContent.includes('S03E01'), 'REGRESSION CHECK: marking the second special watched correctly advances to season 3 instead of doing nothing');

  const persisted = JSON.parse(storageBackend.getItem('my-shows-library-v1'))[0];
  assert.strictEqual(persisted.watchedEpisodeId, 623241, "persisted watched id is the Christmas special's unique id, unambiguous");

  console.log('testDuplicateSpecialsRegression passed.');
}

async function testLegacyDataMigration() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.com' });
  const { window } = dom;
  freezeDate(window, '2026-07-12T12:00:00');
  const storageBackend = window.localStorage;
  window.fetch = (url) => mockFetch(url);

  storageBackend.setItem('my-shows-library-v1', JSON.stringify([
    { showId: 501, platform: 'Hulu', watchedThrough: { season: 4, number: 2 } }
  ]));

  const scriptBody = html.match(/<script>([\s\S]*)<\/script>/)[1];
  window.eval(scriptBody);
  await wait(50);

  const rowSub = window.document.querySelector('.row-sub');
  assert.ok(rowSub, 'legacy data loads without crashing');
  assert.ok(rowSub.textContent.includes('S04E03'), 'legacy watchedThrough correctly resolves to next episode S4E3');

  const persisted = JSON.parse(storageBackend.getItem('my-shows-library-v1'))[0];
  assert.strictEqual(persisted.watchedEpisodeId, 1002, "legacy data migrated to a concrete watchedEpisodeId (S4E2's id)");
  assert.strictEqual(persisted.watchedThrough, undefined, 'old watchedThrough field removed after migration');

  console.log('testLegacyDataMigration passed.');
}

async function testSearchInputStaysStableWhileTyping() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.com' });
  const { window } = dom;
  freezeDate(window, '2026-07-12T12:00:00');
  window.fetch = (url) => mockFetch(url);

  const scriptBody = html.match(/<script>([\s\S]*)<\/script>/)[1];
  window.eval(scriptBody);
  await wait(20);

  window.document.getElementById('add-btn').click();
  await wait(10);

  const searchInput = window.document.getElementById('search-input');
  assert.ok(searchInput, 'search input exists');
  searchInput.focus();
  assert.strictEqual(window.document.activeElement, searchInput, 'sanity check: input is focused before typing begins');

  // Simulate typing "The Bear" character by character, exactly like real
  // typing would trigger the debounced search multiple times if the user
  // pauses. The bug was that each search-results update replaced the whole
  // screen (including the input), so the input node identity changed and
  // iOS Safari dropped focus/keyboard as a result.
  searchInput.value = 'The';
  searchInput.oninput({ target: searchInput });
  await wait(400);

  const inputAfterFirstSearch = window.document.getElementById('search-input');
  assert.strictEqual(inputAfterFirstSearch, searchInput, 'input DOM node is the SAME element after first search results arrive (not recreated)');
  assert.strictEqual(window.document.activeElement, searchInput, 'input retains focus after results render (no lost-focus/keyboard-dismiss bug)');

  searchInput.value = 'The Bear';
  searchInput.oninput({ target: searchInput });
  await wait(400);

  const inputAfterSecondSearch = window.document.getElementById('search-input');
  assert.strictEqual(inputAfterSecondSearch, searchInput, 'input DOM node is STILL the same element after a second search (not recreated on every keystroke)');

  const resultNode = window.document.querySelector('.search-result[data-id="501"]');
  assert.ok(resultNode, 'search results still render correctly via the isolated results container');

  console.log('testSearchInputStaysStableWhileTyping passed.');
}

async function testSearchErrorVisibility() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.com' });
  const { window } = dom;
  freezeDate(window, '2026-07-12T12:00:00');
  // Simulate a fetch failure, e.g. blocked network on the phone.
  window.fetch = (url) => {
    if (url.startsWith('https://api.tvmaze.com/search/shows')) {
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    return mockFetch(url);
  };

  const scriptBody = html.match(/<script>([\s\S]*)<\/script>/)[1];
  window.eval(scriptBody);
  await wait(20);

  window.document.getElementById('add-btn').click();
  await wait(10);

  const searchInput = window.document.getElementById('search-input');
  searchInput.value = 'Downton';
  searchInput.oninput({ target: searchInput });
  await wait(400);

  const errorText = window.document.querySelector('.error-text');
  assert.ok(errorText, 'a visible error message renders when the search request fails');
  assert.ok(errorText.textContent.includes('Failed to fetch'), 'the actual underlying error is shown, not swallowed silently');

  console.log('testSearchErrorVisibility passed.');
}

async function testBackupAndRestore() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.com' });
  const { window } = dom;
  freezeDate(window, '2026-07-12T12:00:00');
  const storageBackend = window.localStorage;
  window.fetch = (url) => mockFetch(url);

  storageBackend.setItem('my-shows-library-v1', JSON.stringify([
    { showId: 501, platform: 'Hulu', watchedEpisodeId: 1002, pendingSeasonNumber: null }
  ]));

  const scriptBody = html.match(/<script>([\s\S]*)<\/script>/)[1];
  window.eval(scriptBody);
  await wait(50);

  // --- Open backup view, verify the backup code reflects current data ---
  window.document.getElementById('backup-btn').click();
  await wait(10);
  assert.strictEqual(window.state.view, 'backup', 'backup button navigates to backup view');

  const backupOutput = window.document.getElementById('backup-output');
  const backupCode = JSON.parse(backupOutput.value);
  assert.strictEqual(backupCode.length, 1);
  assert.strictEqual(backupCode[0].showId, 501, 'backup code contains the current library data');

  // --- Restore: invalid JSON is rejected with a clear error ---
  const restoreInput = window.document.getElementById('restore-input');
  restoreInput.value = 'not valid json{{{';
  restoreInput.oninput({ target: restoreInput });
  window.document.getElementById('restore-btn').click();
  await wait(10);
  let errorText = window.document.querySelector('.error-text');
  assert.ok(errorText, 'invalid JSON shows an error instead of crashing');

  // --- Restore: valid-JSON-but-wrong-shape is also rejected ---
  const restoreInput2 = window.document.getElementById('restore-input');
  restoreInput2.value = JSON.stringify({ notAShowsList: true });
  restoreInput2.oninput({ target: restoreInput2 });
  window.document.getElementById('restore-btn').click();
  await wait(10);
  errorText = window.document.querySelector('.error-text');
  assert.ok(errorText, 'wrong-shaped JSON is rejected as an invalid backup code');

  // --- Restore: a valid backup code replaces the library and persists ---
  const validBackup = JSON.stringify([
    { showId: 251, platform: 'Peacock', watchedEpisodeId: 20865, pendingSeasonNumber: null }
  ]);
  const restoreInput3 = window.document.getElementById('restore-input');
  restoreInput3.value = validBackup;
  restoreInput3.oninput({ target: restoreInput3 });
  window.document.getElementById('restore-btn').click();
  await wait(50);

  assert.strictEqual(window.state.view, 'list', 'after a successful restore, returns to the list view');
  const persisted = JSON.parse(storageBackend.getItem('my-shows-library-v1'));
  assert.strictEqual(persisted.length, 1);
  assert.strictEqual(persisted[0].showId, 251, 'restored data replaces the old library and persists to storage');

  const rowTitle = window.document.querySelector('.row-title');
  assert.ok(rowTitle.innerHTML.includes('Downton Abbey'), 'restored show appears correctly in the list after restore');

  console.log('testBackupAndRestore passed.');
}

(async () => {
  try {
    await testMainFlow();
    await testDuplicateSpecialsRegression();
    await testLegacyDataMigration();
    await testSearchInputStaysStableWhileTyping();
    await testSearchErrorVisibility();
    await testBackupAndRestore();
    console.log('All app integration tests passed.');
  } catch (err) {
    console.error('TEST FAILED:', err);
    process.exit(1);
  }
})();
