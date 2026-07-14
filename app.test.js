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
  { id: 1003, season: 4, number: 3, name: 'Doors', airdate: '2026-06-25', runtime: 32, summary: '<p>Ep 3.</p>', image: { medium: 'https://example.com/s4e3-medium.jpg', original: 'https://example.com/s4e3-original.jpg' } },
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

// A minimal third show, used only to test available-group ordering
// (top-on-add, bottom-on-still-available-after-mark-watched).
const mockFreshShowInfo = {
  id: 999, name: 'Fresh Show', status: 'Running', premiered: '2020-01-01',
  network: { name: 'Test Network' }, image: { medium: 'https://example.com/fresh.jpg' }
};
const mockFreshShowEpisodes = [
  { id: 9001, season: 1, number: 1, name: 'Pilot', airdate: '2020-01-01', runtime: 30, summary: '<p>Pilot.</p>' }
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
  if (url === 'https://api.tvmaze.com/shows/999') {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockFreshShowInfo) });
  }
  if (url === 'https://api.tvmaze.com/shows/999/episodes?specials=1') {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockFreshShowEpisodes) });
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

  const episodeImage = window.document.querySelector('.episode-image');
  assert.ok(episodeImage, 'episode still image renders when TVmaze provides one');
  assert.strictEqual(episodeImage.getAttribute('src'), 'https://example.com/s4e3-medium.jpg', 'episode image uses the medium-size TVmaze image URL');

  // The Bear mock data is a single season (4) with 4 episodes. Next up is
  // S4E3 (index 2 of 4), so 2 episodes remain in the season (E3 itself + E4).
  // No season number greater than 4 exists in the mock data, so 0 of 1
  // seasons remain.
  let detailTable = window.document.querySelector('.detail-table');
  assert.ok(detailTable.textContent.includes('Episodes left in season'), 'detail screen shows episodes-left-in-season row');
  assert.ok(/Episodes left in season\s*2/.test(detailTable.textContent), 'S4E3 of 4 in-mock-data episodes leaves 2 (E3, E4)');
  assert.ok(detailTable.textContent.includes('Seasons remaining'), 'detail screen shows seasons-remaining row');
  assert.ok(/Seasons remaining\s*0 of 1/.test(detailTable.textContent), 'only season 4 exists in mock data, so 0 of 1 seasons remain');

  window.document.getElementById('mark-watched-btn').click();
  await wait(10);
  let subLine = window.document.querySelector('.row-sub');
  assert.ok(subLine.textContent.includes('S04E04'), 'after marking watched, detail advances to next episode S4E4');

  assert.ok(!window.document.querySelector('.episode-image'), 'no broken image element renders when an episode (S4E4) has no TVmaze image');

  detailTable = window.document.querySelector('.detail-table');
  assert.ok(detailTable.textContent.includes('Aug 20, 2026'), 'air date formatted correctly for future episode');
  assert.ok(/Episodes left in season\s*1/.test(detailTable.textContent), 'S4E4 is the last episode in the mock data, so 1 (itself) remains');

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

async function testAvailableGroupOrdering() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.com' });
  const { window } = dom;
  freezeDate(window, '2026-07-12T12:00:00');
  const storageBackend = window.localStorage;
  window.fetch = (url) => mockFetch(url);

  // Two pre-existing shows, both already "available" (untouched, baseline order 0).
  storageBackend.setItem('my-shows-library-v1', JSON.stringify([
    { showId: 501, platform: '', watchedEpisodeId: null, pendingSeasonNumber: { season: 4, number: 2 } }, // next: S4E3, aired
    { showId: 251, platform: '', watchedEpisodeId: null, pendingSeasonNumber: { season: 2, number: 7 } }  // next: S2E8, aired
  ]));

  const scriptBody = html.match(/<script>([\s\S]*)<\/script>/)[1];
  window.eval(scriptBody);
  await wait(50);

  let rowTitles = [...window.document.querySelectorAll('.row-title')].map(el => el.textContent);
  assert.deepStrictEqual(rowTitles, ['The Bear', 'Downton Abbey'], 'both pre-existing shows start in original order (both untouched, baseline 0)');

  // --- Add a new show that lands directly in "available" -> should go to the TOP ---
  const newItem = { showId: 999, platform: '', watchedEpisodeId: null, pendingSeasonNumber: null };
  window.state.library.push(newItem);
  await window.refreshComputedFor([newItem], { isNewAddition: true });
  window.render();
  await wait(10);

  rowTitles = [...window.document.querySelectorAll('.row-title')].map(el => el.textContent);
  assert.strictEqual(rowTitles[0], 'Fresh Show', 'newly-added show that is immediately available appears at the TOP of the available group');

  const persistedAfterAdd = JSON.parse(storageBackend.getItem('my-shows-library-v1'));
  const freshItem = persistedAfterAdd.find(i => i.showId === 999);
  assert.ok(freshItem.availableOrder < 0, 'newly-added available show gets a negative (top) availableOrder, persisted');

  // --- Mark Downton Abbey watched: next episode is "Behind the Drama", also
  // already aired, so it stays "available" -> should move to the BOTTOM ---
  window.document.getElementById('mark-251').click();
  await wait(10);

  rowTitles = [...window.document.querySelectorAll('.row-title')].map(el => el.textContent);
  assert.strictEqual(rowTitles[rowTitles.length - 1], 'Downton Abbey', 'a show that stays available right after being marked watched moves to the BOTTOM');
  assert.notStrictEqual(rowTitles[0], 'Downton Abbey', 'Downton Abbey is no longer at the top after being marked watched');

  const persistedAfterMark = JSON.parse(storageBackend.getItem('my-shows-library-v1'));
  const downtonItem = persistedAfterMark.find(i => i.showId === 251);
  const bearItem = persistedAfterMark.find(i => i.showId === 501);
  assert.ok(downtonItem.availableOrder > (bearItem.availableOrder || 0), 'Downton Abbey\'s availableOrder is now greater (further down) than an untouched show');

  console.log('testAvailableGroupOrdering passed.');
}

async function testBackupDownload() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.com' });
  const { window } = dom;
  freezeDate(window, '2026-07-12T12:00:00');
  window.fetch = (url) => mockFetch(url);

  // jsdom doesn't implement createObjectURL by default; provide a minimal
  // mock and capture what gets passed to it and to the anchor's click().
  let capturedBlob = null;
  window.URL.createObjectURL = (blob) => { capturedBlob = blob; return 'blob:mock-url'; };
  window.URL.revokeObjectURL = () => {};
  const originalClick = window.HTMLAnchorElement.prototype.click;
  let clickedAnchor = null;
  window.HTMLAnchorElement.prototype.click = function () { clickedAnchor = this; };

  window.localStorage.setItem('my-shows-library-v1', JSON.stringify([{ showId: 501, platform: 'Hulu', watchedEpisodeId: 1002, pendingSeasonNumber: null }]));

  const scriptBody = html.match(/<script>([\s\S]*)<\/script>/)[1];
  window.eval(scriptBody);
  await wait(50);

  window.document.getElementById('backup-btn').click();
  await wait(10);
  assert.strictEqual(window.state.view, 'backup', 'backup button navigates to backup view');

  window.document.getElementById('download-backup-btn').click();

  assert.ok(clickedAnchor, 'clicking Download backup file triggers a file download');
  assert.match(clickedAnchor.download, /^my-shows-backup-\d{4}-\d{2}-\d{2}\.json$/, 'downloaded file has a dated filename');
  assert.ok(capturedBlob, 'a Blob was created for the download');
  assert.strictEqual(capturedBlob.type, 'application/json', 'backup file is JSON');

  const text = await capturedBlob.text();
  const parsed = JSON.parse(text);
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].showId, 501, 'downloaded backup file contains the current library data');

  window.HTMLAnchorElement.prototype.click = originalClick;
  console.log('testBackupDownload passed.');
}

async function testBackupRestoreFromFile() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.com' });
  const { window } = dom;
  freezeDate(window, '2026-07-12T12:00:00');
  const storageBackend = window.localStorage;
  window.fetch = (url) => mockFetch(url);

  window.localStorage.setItem('my-shows-library-v1', JSON.stringify([{ showId: 501, platform: 'Hulu', watchedEpisodeId: 1002, pendingSeasonNumber: null }]));

  const scriptBody = html.match(/<script>([\s\S]*)<\/script>/)[1];
  window.eval(scriptBody);
  await wait(50);

  window.document.getElementById('backup-btn').click();
  await wait(10);

  const fileInput = window.document.getElementById('restore-file-input');

  // --- Invalid JSON file is rejected with a clear error, not a crash ---
  let badFile = new window.File(['not valid json{{{'], 'backup.json', { type: 'application/json' });
  fileInput.onchange({ target: { files: [badFile] } });
  await wait(20);
  let errorText = window.document.querySelector('.error-text');
  assert.ok(errorText, 'a malformed JSON file shows an error instead of crashing');

  // --- Valid JSON but wrong shape is also rejected ---
  let wrongShapeFile = new window.File([JSON.stringify({ notAShowsList: true })], 'backup.json', { type: 'application/json' });
  fileInput.onchange({ target: { files: [wrongShapeFile] } });
  await wait(20);
  errorText = window.document.querySelector('.error-text');
  assert.ok(errorText, 'wrong-shaped JSON is rejected as an invalid backup file');

  // --- A valid backup file replaces the library and persists ---
  const validBackup = JSON.stringify([
    { showId: 251, platform: 'Peacock', watchedEpisodeId: 20865, pendingSeasonNumber: null }
  ]);
  let goodFile = new window.File([validBackup], 'backup.json', { type: 'application/json' });
  fileInput.onchange({ target: { files: [goodFile] } });
  await wait(50);

  assert.strictEqual(window.state.view, 'list', 'after a successful restore, returns to the list view');
  const persisted = JSON.parse(storageBackend.getItem('my-shows-library-v1'));
  assert.strictEqual(persisted.length, 1);
  assert.strictEqual(persisted[0].showId, 251, 'restored data from the file replaces the old library and persists to storage');

  const rowTitle = window.document.querySelector('.row-title');
  assert.ok(rowTitle.innerHTML.includes('Downton Abbey'), 'restored show appears correctly in the list after restore');

  console.log('testBackupRestoreFromFile passed.');
}

async function testEpisodesLeftAndSeasonsRemainingOnDetailScreen() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.com' });
  const { window } = dom;
  freezeDate(window, '2026-07-12T12:00:00');
  window.fetch = (url) => mockFetch(url);

  // Downton Abbey mock data spans season 2 (4 entries: E7, E8, and two
  // specials) and season 3 (1 entry). Starting from watched = S2E7, next up
  // is S2E8: 3 episodes remain in season 2 (E8 + the two specials that
  // follow it by airdate), and 1 season remains (season 3) out of 2 total.
  window.localStorage.setItem('my-shows-library-v1', JSON.stringify([
    { showId: 251, platform: '', watchedEpisodeId: 20864, pendingSeasonNumber: null }
  ]));

  const scriptBody = html.match(/<script>([\s\S]*)<\/script>/)[1];
  window.eval(scriptBody);
  await wait(50);

  window.document.getElementById('row-251').click();
  await wait(10);

  const detailTable = window.document.querySelector('.detail-table');
  assert.ok(/Episodes left in season\s*3/.test(detailTable.textContent), 'S2E8 plus two trailing season-2 specials = 3 left in season');
  assert.ok(/Seasons remaining\s*1 of 2/.test(detailTable.textContent), 'season 3 remains out of 2 total seasons in the mock data');

  console.log('testEpisodesLeftAndSeasonsRemainingOnDetailScreen passed.');
}

(async () => {
  try {
    await testMainFlow();
    await testDuplicateSpecialsRegression();
    await testLegacyDataMigration();
    await testSearchInputStaysStableWhileTyping();
    await testSearchErrorVisibility();
    await testBackupDownload();
    await testBackupRestoreFromFile();
    await testAvailableGroupOrdering();
    await testEpisodesLeftAndSeasonsRemainingOnDetailScreen();
    console.log('All app integration tests passed.');
  } catch (err) {
    console.error('TEST FAILED:', err);
    process.exit(1);
  }
})();
