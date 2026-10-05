# Slates: notes for coding agents

`web/` is the Next 16 portal (read `web/AGENTS.md` before touching it), `scraper/` the Playwright Schoology service, `desktop/` the Electron shell, `mobile/` the Capacitor app, `bin/` the `slates` CLI.

## The host PC

The backend runs on the always-on gaming PC ("smaran", Windows 11), reached over Tailscale at `https://smaran.tail55de6b.ts.net` (tailnet only). The Mac's desktop app and the phone are windows onto it (`SLATES_HOST` in `~/.slates/.env`).

- SSH is key-only and tailnet-only: `ssh -i ~/.ssh/slates_pc email@100.79.163.21`. The default key and the Mac username are refused. SSH lands in cmd.exe: wrap commands in `powershell -NoProfile -Command "..."` (PowerShell 5.1), and for anything with pipes or regexes `scp` a `.ps1` over and run it with `powershell -NoProfile -ExecutionPolicy Bypass -File`, since cmd splits on `|` even inside quotes.
- The PC runs `node bin/slates.js host` from `C:\Users\email\slates` through the "Slates host" scheduled task (headless console). Log: `%USERPROFILE%\.slates\logs\host.log`.
- The portal is published with `tailscale funnel` (internet + tailnet), locked to paired devices by `web/proxy.ts` + `web/lib/devices.ts` (registry `%USERPROFILE%\.slates\devices.json`). Devices pair by visiting once over the tailnet, or by typing a one-time code from Settings › General › Devices on the "not paired" page (`/api/devices/code` makes it, `/api/devices/pair` takes it); requests on the host itself pass. From the Mac over Tailscale, curl gets in on Tailscale's identity; from outside it needs `Authorization: Bearer <key>` (mint one with `POST /api/devices` over Tailscale). Never publish the portal with anything but Tailscale.

## Deploying to the PC

1. Commit on the Mac. If `main` is pushed, run `git pull --ff-only` on the PC. If not, ship a bundle: `git bundle create /tmp/slates.bundle <pc-head>..main`, copy it over with `scp`, then on the PC run `git fetch <bundle> main` and `git merge --ff-only FETCH_HEAD`.
2. Restart: `node bin\slates.js host --stop`, then `Start-ScheduledTask -TaskName "Slates host"`. It reinstalls when the lockfile changed and rebuilds when HEAD changed (a few minutes of downtime), then logs "portal ready". A restart ends any agent turn in progress (agents run inside the portal), so check `GET /api/agent` for one `working` first and tell the student. A cut-off agent says so in its chat and picks up on its next message (`web/lib/agent/runs.ts`).
3. Check from the Mac: `curl -H "sec-fetch-site: same-origin" https://smaran.tail55de6b.ts.net/api/host` (open to anyone; other paths need Tailscale on or a device key).

## The desktop app

- Build from a clean checkout, so other sessions' uncommitted work stays out: `git worktree add --detach /tmp/slates-build HEAD`, `npm ci` in `web/`, `desktop/` and `scraper/`, then `npm run dist:mac` in `desktop/`. Install by swapping `desktop/dist/mac-arm64/Slates.app` into `/Applications`.
- Shells started by the IDE carry `ELECTRON_RUN_AS_NODE=1`, and `open` passes it on, so Slates exits at once as plain Node. Launch with `env -u ELECTRON_RUN_AS_NODE open -a Slates`; the Dock is unaffected.
- On displays at least 2400 points wide (the 27" 1440p monitor, 5K, 4K scaled to 1440p) the window zooms to 120% (`zoomFor` in `desktop/main.mjs`), re-fitted when it moves to another display or loads another origin, so a zoom set by hand holds until then. The window's size and place are kept in `window-state.json` in userData. Layouts for pages over 1800 CSS px (one class's grades in columns, wider calendar, tutor and study; the class and grades lists stay one per row) are in `web/app/wide.css`, loaded after `globals.css`.
- In remote mode AI Usage still reads the Mac: `desktop/preload.cjs` gives the window a bridge, `main.mjs` (`LOCAL_APPS`) starts the bundled portal on the Mac on first use with `SLATES_USAGE_ONLY=1` (no routines), and `web/lib/desktop-bridge.ts` sends `/api/usage/coding` through it. Slates' own calls come from the host's ledger (`/api/usage?view=events`).

## The iPhone app

The Capacitor shell in `mobile/` opens the host's URL from `mobile/.env`, so web changes reach the phone with a host deploy; rebuild the app only for native or `capacitor.config.ts` changes. With the phone plugged in (`xcrun devicectl list devices` gives its id): `npx cap sync ios` in `mobile/`, then `xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'platform=iOS,id=<id>' -derivedDataPath /tmp/slates-ios-build -allowProvisioningUpdates DEVELOPMENT_TEAM=M7Y3TAH3UX PRODUCT_BUNDLE_IDENTIFIER=com.smaranz.slates build` and `xcrun devicectl device install app --device <id> /tmp/slates-ios-build/Build/Products/Debug-iphoneos/App.app`. The team is a free Personal Team: `com.slates.app` is registered to someone else (hence the override), the profile lapses after 7 days (reinstall to renew; the app keeps its data and pairing), and a phone holds only 3 such apps.

## AI Usage: switching accounts

The Switch accounts view (`web/components/usage/SwitchView.tsx`, server side in `web/lib/ai-usage/switch/`) changes the everyday sign-in of three tools, Janus-style: park the live login, put a saved one in its place.
- Claude Code: keychain `Claude Code-credentials` plus only the account's keys of `~/.claude.json` (`CLAUDE_ACCOUNT_KEYS` in `core.ts`; projects and MCP servers stay). Parked accounts' limits renew their own token; the live one is never renewed.
- agy: keychain `gemini`/`antigravity` (go-keyring) and `~/.gemini/antigravity-cli/antigravity-oauth-token`. A parked account is measured by running `agy -p /usage` in a throwaway home holding only its token file.
- The Devin app: the `windsurf_auth` secrets in `~/Library/Application Support/Devin/User/globalStorage/state.vscdb`, moved still encrypted and written only while Devin is closed (a switch quits and reopens it, so never run one from inside a Devin session). Reading who's signed in and live limits (`GetUserStatus` with the login's own key) needs the "Devin Safe Storage" key, which is only read after the student presses Allow, since macOS prompts for it. Test writes against a copy with `SLATES_DEVIN_STATE_DB`.

Saved logins are keychain items under `Slates accounts`; the rest is in `~/.slates/usage/switch` (0600). `npx tsx --test lib/ai-usage/switch/switch.test.ts` covers the order of operations against fakes.

## Study Studio

Sets live in `~/.slates/study` on the host. `web/lib/study/gather.ts` reads the unit through the sync service (Materials folders and every subfolder of the matching unit, Pages and link views via `/course/page`, files via `/course/document` + `/course/file`); the study agent (`web/lib/study/agent.ts`) then researches with the Agent app's tools and the browser it shares with the tutor. School-only Google files are read with that shared browser's Google sign-in (`web/lib/study/google.ts`); the sync browser has no Google session. `npx tsx --test lib/study/*.test.ts` in `web/`.

Students can also choose a set's material before it builds (`web/components/study/StudyBuildSheet.tsx`): Materials items picked through `/api/study/materials`, files uploaded through `/api/study/upload` (kept in `~/.slates/study/uploads`, text read on arrival, 25 MB cap, hence `proxyClientMaxBodySize` in `web/next.config.ts`), notes on what the test covers, and whether the automatic Schoology search runs. `gather` reads those right after the test's own write-up; the choices are kept on the set as `inputs` so a rebuild reuses them. A test the student adds by hand gets a `c…` set id (`web/lib/study/store.ts`). `web/lib/study/choose.test.ts` covers it.

Scanned PDFs (no text layer, or only a scanner app's stamp) and photos are read off the page by a vision model (`web/lib/study/scan.ts`): GPT-6 Luna, through OpenRouter first and then straight from OpenAI, falling through when a key is missing or refused. That covers uploads and Schoology files alike, and the text is kept, so each file is read once. On the host the OpenAI key in `.env` is refused (401) and OpenRouter's works. `web/lib/study/scan.test.ts` swaps the model for a fake.

## Memory, recall and learning

`web/lib/learning/`, after Hermes Agent's learning loop, shared by the agents and the tutor:
- Memory (`memory.ts`): the student profile every helper shares (`~/.slates/memory/student.json`, 2,500 chars) and each helper's own notes (an agent's on its profile in `agents.json`, the tutor's in `~/.slates/memory/tutor.json`, 2,200 chars), shown in full at the top of every turn. One `memory` tool edits both (add, replace, remove; entries found by a piece of their text; a full book refuses until the helper merges or drops entries). The student sees and corrects it in the tutor's Memory panel and an agent's details (`/api/memory`). The first time the profile is read, agents' older memories (their old `remember` tool saved facts about the student) move into it once, newest first while there's room (marker `~/.slates/memory/.adopted-agent-memory`).
- Recall (`recall.ts`): `search_chats`, plain word matching over agent chats and the tutor's copies in `~/.slates/memory/tutor-chats` (written by `/api/tutor` after each reply; deleting a chat in the tutor deletes its copy).
- Skills (`skills.ts`): the shared library in `~/.slates/agent/skills.json`, now with a description per skill (the part prompts show) and `patch_skill` to fix one in place.
- Review (`review.ts`): after a reply, a background Cursor run (composer-2.5 first) with only the memory and skill tools saves what the helper missed. Due right away after a message that sounds worth remembering, every 4 student turns, or after enough tool work; a helper that saved something itself resets the count. What it saves shows as `learned` lines (agents: chat events; tutor: `/api/tutor/review`).
- `npx tsx --test lib/learning/*.test.ts` swaps the review model for a fake.

## Agents' browsers

Every agent has its own headless Chrome on the host (`web/lib/agent/browser.ts`), with its own tabs and sign-ins: profile `~/.slates/agent/browsers/<agent id>`, started on the agent's first turn (or Start browser in its Computer), on whatever port is free. That port is read from `DevToolsActivePort` in the profile and trusted only while `/json/version` answers with the same browser id, since the file outlives Chrome and the port can pass to another agent's. Deleting an agent closes its Chrome and deletes the profile. The tutor and Study builds share the one browser every agent used to share (`~/.slates/agent/browser`, port 7532, `SLATES_AGENT_CDP_PORT`), whose Google sign-in Study's `google.ts` reads. `/api/agent/computer?agent=<id>` streams and drives an agent's (POST takes `agent` in the body), and with no agent the shared one; Agent › Computer picks between them and lists the shared one as "Tutor & Study". Agents made before 2026-10-04 21:45 UTC got a one-time copy of the shared browser's cookies in their own (`OWN_BROWSERS_SINCE`). `NODE_PATH=<stub> npx tsx --test lib/agent/browser.test.ts` runs real headless Chromes in a throwaway home (skipped without Chrome).

## Files agents send, and the tutor as an agent

- `send_file` copies a file from the PC into `~/.slates/agent/outbox` and posts a file card; `/api/agent/outbox` serves sent files (`?id=`) and the agents' workspace (`?workspace=1`, `?path=`), listed in Agent › Files. HTML and SVG are never served inline (they'd run on Slates' origin). `npx tsx --test lib/agent/outbox.test.ts`.
- The Mac app saves host files into `~/Downloads/Slates` through the window's own session (`slates:save-file` in `desktop/main.mjs`, `saveHostFile`/`openHostFile` in `web/lib/desktop-bridge.ts`): the system browser isn't paired, so plain links to host files don't open there. `web/components/DesktopInbox.tsx` saves files agents send as they arrive, with a notification, and catches up on the last week at launch (toggle in Agent › Files). Needs a desktop rebuild.
- The tutor (`web/lib/tutor-tools.ts`) has memory, recall, skills, `slates_board`, `message_agent` (hands a job to an agent's own chat), `save_file` and the shared browser on every backend: Playwright MCP tools started lazily for OpenAI/OpenRouter (`web/lib/agent/browser-tools.ts`, allowlisted), MCP servers for Claude Code, and Cursor in agent mode with built-in tools cut to the web. Still no shell. Screenshots go only to OpenAI: Gemini on OpenRouter refuses a request with an image in a tool result.

## Devin in the tutor

The tutor's picker has a Devin group: every family `devin models list` gave (`web/lib/devin-models.ts`, refresh it by hand), run through `devin acp` (`web/lib/devin-acp.ts`) in "ask" mode with every permission turned down, so it can search the web but not touch files. The thinking level picks the family's nearest variant. The login is `credentials.toml`: `~/.local/share/devin` on the Mac, `%APPDATA%\devin` on the PC (installed with `irm https://cli.devin.ai/install.ps1 | iex`, which then starts an interactive `devin setup` that hangs over SSH; kill it). `npx tsx --test lib/devin-models.test.ts`.

## Schoology updates

Teachers' posts to their classes are read by `scraper/updates.mjs` from `/home/feed?page=N` (JSON wrapping the feed's markup) through the sync browser's session, with full text from each post's "Show More" link cached in `~/.slates/update-bodies.json`. Schoology answers a burst of requests with 429, so they're spaced out, and a sync whose first page holds nothing new reuses the last read. Posts land in the snapshot as `updates`, matched to a class by the course page id in its `url`. School shows them only on each class's page, the way Schoology files them, under the class menu (Materials, Updates, Grades) in `web/components/ClassesView.tsx`; the class list says which classes have new posts. There is no sidebar feed: the student asked to keep them in Classes. `web/lib/updates.ts` keeps what counts as new: the ids a class page has shown, after a first-run baseline (`npx tsx --test lib/updates.test.ts`).

## Signing in to Schoology

When the sync is signed out, or was never signed in, Settings › School › Schoology sync and the sidebar show Sign in to Schoology. It opens Schoology in the sync browser itself (`scraper/signin.mjs`, `/signin/*` in `serve.mjs`) and streams it into a full-window overlay (`web/components/SchoologySignIn.tsx`, via `/api/scrape/signin/[action]`): screencast frames out, clicks and keys in, like the attempt viewer. The student signs in as usual (FUHSD goes straight to Google), and the session stays in `~/.slates/chrome-profile`. Nothing is copied from the agents' browser; that was the first version (Reconnect), replaced at the student's choice. The sign-in counts once the district's own `/home` renders signed in (anything else is checked in a separate page, so the student's page never moves). Then `config.json` gets `loggedInAt` and a sync runs. Background syncs and fresh `/snapshot`s wait while it's open. It closes after 5 minutes with nobody watching, or 15 in all. Typed input is never logged. `npm run login` still works at the machine itself. `node --test signin.test.mjs` in `scraper/`.

## Health

The Health room (`web/components/health/`, server side in `web/lib/health/`) is CalAi's calorie tracker (`~/smaran/projects/CalAi`, SwiftUI) rebuilt as a Slates room, laid out for the student's iPhone 13 mini first: a bottom bar (Today, Progress, Me) and a + within thumb reach, sheets for every sub-task, two columns on the Mac. F45 is off the phone's bar at the student's request: the day's F45 card on Today opens it, its page leads back to Today, and the Mac keeps it in its tabs.
- The record lives on the host in `~/.slates/health` (`profile.json`, `log.json`, meal photos in `photos/`), so the phone and the Mac share it (`web/lib/health/store.ts`, every field checked on arrival). Days are the logging device's own `YYYY-MM-DD`. Targets come from `web/lib/health/nutrition.ts`, ported from CalAi's `NutritionCalculator`/`DayStats` (Mifflin–St Jeor, 7,700 kcal/kg, sex floors, a protein floor of 1.6 g/kg for people who train).
- Meals are read by GPT-6 Luna (OpenRouter, then OpenAI) from a photo, a label, a barcode or a description, with CalAi's prompts and validator (`web/lib/health/analyze.ts`); barcodes and search go to Open Food Facts (`web/lib/health/foods.ts`). Usage lands in AI Usage as Health.
- F45 sync: every studio page embeds its record (`STUDIO_DATA`, Cupertino at 19700 Vallco Pkwy is id 1670), and its schedule widget reads `booking.api.f45training.com/v2/schedule/classes?from&to&studio_id&service_category_code=training` without a sign-in: each day's workout and type, class times, coaches, spots booked. `web/lib/health/f45.ts` asks the same, a week back and ahead, refreshed every 5 minutes, last good copy on disk for when F45 is down. Booking stays in F45's app (it needs the member's login). The studio is a page slug in Me.
- The iPhone app needs `NSCameraUsageDescription` for Scan (WebKit offers "Take Photo" on any image input and iOS kills an app without the string). Builds with it say `SlatesCamera` in the user agent (`mobile/capacitor.config.ts`); older builds get a notice instead of a photo input (`cameraSafe` in `useHealth.ts`). So a rebuild and reinstall (above) turns scanning on.
- `npx tsx --test lib/health/*.test.ts` in `web/`: the math, the validator with a fake model, the F45 parser against a trimmed fixture, the store in a throwaway home.

## Schedule

The Schedule room (`web/components/day/DayApp.tsx`, mode `day`) shows the student's day hour by hour: what's on now, how long it has left and what's next, the day as a timeline that fills in as it goes, the next six days a tap away, and how the day splits into coding, school, Instagram and the rest. One column on the phone; the now card beside the timeline on the Mac.
- The week is a timetable in `web/lib/day/schedule.ts`: each row starts a block that runs until the next row, the last until sleep, so a change is one line and a deploy. As the student gave it: school 8:30–4:00 Mon/Tue/Thu, 11:00–3:15 Wed, 10:00–3:15 Fri (leaving home, then home again); up at 6:00 on school days, an hour to get ready, then coding + product until it's time to leave; after school a snack, coding + product until dinner at 7:00, Instagram content 7:30–9:00, free time, sleep at 10:30. Weekends: up at 8:00, study, coding + product, Instagram content.
- It runs on the device's clock alone (nothing on the host), re-rendering as each minute turns and when the window comes back.
- Eight launcher doors don't fit on one row of a laptop window, so the launcher folds them into rows of four there (`globals.css`, by `:has(> :nth-child(8))`).
- `npx tsx --test lib/day/schedule.test.ts` in `web/`.

## Working here

- In `web/`: `npx tsc --noEmit`, `npx eslint <paths>`, `npx tsx --test <file>.test.ts`. Tests that load a `server-only` module need a stub, since only Next provides it: point `NODE_PATH` at a folder holding an empty `server-only` package.
- Several agent sessions may share this checkout. Commit only your own paths (`git commit -- <paths>`), check `git diff --cached` first, and never sweep up another session's staged changes.
- Never print values from `~/.slates/.env`; compare keys by hash.
