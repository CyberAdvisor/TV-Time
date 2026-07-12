# My Shows

A simple TV episode tracker: keep a list of shows you're watching, mark episodes watched, and always see what's next.

## Why this exists

Built after the TV Time app shut down. The goal was a minimal replacement that does one thing well: given a show and where you left off, tell you what episode to watch next — with no ads, no account, no social feed, and no clutter.

## What it does

- **Add a show** by searching (data comes from [TVmaze](https://www.tvmaze.com), a free public TV database — no account or API key needed)
- **Track your progress** by entering the last episode you watched; the app figures out what's next
- **Note where you're watching it** (Hulu, Netflix, whatever) — shown next to the show name and on the episode detail screen
- **Groups your shows** into:
  - **Available now** — the next episode has already aired
  - **Upcoming** — a future air date is known, with a countdown
  - **Pending return** — the show is renewed but no return date has been announced yet
  - **Completed** — you've watched everything and the series has ended
- **Includes specials** (Christmas specials, series finales tagged as specials, etc.) in their correct place in the timeline, based on air date — not just numbered regular episodes
- **One tap to mark watched**, which then shows the next episode

## How it's built

A single self-contained `index.html` file — plain HTML, CSS, and JavaScript. No build step, no framework, no dependencies to install. It calls the public TVmaze API directly from your browser.

## Data storage — read this

**Your show list is stored only in your browser's local storage on your device.** This means:

- **No backup.** If you clear your browser's site data, switch browsers, or switch devices, your list is gone. There is no account, no cloud sync, and no server storing anything.
- **No sharing between devices.** Adding a show on your phone doesn't make it appear on your laptop. Each browser/device has its own separate list.
- **Nothing is sent anywhere except TVmaze.** The only network requests this app makes are to `api.tvmaze.com`, to look up shows and episodes. Your watch list itself never leaves your device.
- **The code being public does not expose your data.** Anyone can view or copy this code, and anyone can use their own copy of the app — but they cannot see or change *your* list, since it's local to your own browser. See the note on hosting below for why the app needs to run from a real web address rather than a downloaded file.

If you want your list backed up or synced, you'd need to add that yourself (e.g., wiring up a small cloud storage backend) — it's not built in.

## Hosting your own copy on GitHub Pages

This needs to run from a real `https://` web address rather than being opened as a downloaded file — iOS Safari in particular blocks network requests (like the TVmaze lookups) from local files for security reasons, even though desktop Safari usually allows it.

1. Go to [github.com/new](https://github.com/new), create a **public** repository (e.g. `my-shows`), and don't initialize it with any files.
2. On the repo page, choose **uploading an existing file**, drag in `index.html`, and commit.
3. Go to **Settings → Pages**, set Source to **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
4. After a minute or so, GitHub gives you a URL like `https://yourusername.github.io/my-shows/`. Open that on your phone, then use Safari's **Share → Add to Home Screen** to get an app-like icon.

## Customizing this with Claude

This app was originally built with [Claude](https://claude.ai). To make changes (add a feature, change the design, fix something), the easiest path is to start a new conversation with Claude and give it context, since a fresh conversation won't know this app's history or the decisions baked into it.

**Included in this repo for that purpose:**
- `CLAUDE_CONTEXT.md` — a technical primer describing the app's data model, architecture, and a few non-obvious gotchas (documented so they don't get silently reintroduced by a future change)
- `logic.js` / `logic.test.js` / `app.test.js` — the core logic pulled out into a testable module, plus the test suite used to verify behavior (episode ordering, specials handling, watched-progress tracking, etc.)

**To customize:**
1. Open a new conversation with Claude.
2. Paste in the contents of `CLAUDE_CONTEXT.md`, or just say "here's the context for an app I'm working on" and attach it.
3. Paste in `index.html` (or attach it) and describe the change you want.
4. Ask Claude to test its changes — the existing test files are there so a change can be checked against the behavior that's already been verified, rather than guessing.
5. Once you have an updated `index.html`, upload it to the GitHub repo (Add file → Upload files, replacing the old one) to deploy the change.

## Limitations

- No login, no cloud sync, no cross-device support
- No notifications when a new episode airs — you have to open the app to check
- Relies entirely on TVmaze's data — if a show isn't in their database, or their episode/special data has gaps, that carries through to the app
- No built-in backup or export of your list
