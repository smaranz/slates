# Slates: notes for coding agents

`web/` is the Next 16 portal (read `web/AGENTS.md` before touching it), `scraper/` the Playwright Schoology service, `desktop/` the Electron shell, `mobile/` the Capacitor app, `bin/` the `slates` CLI.

## The host PC

The backend runs on the always-on gaming PC ("smaran", Windows 11), reached over Tailscale at `https://smaran.tail55de6b.ts.net` (tailnet only). The Mac's desktop app and the phone are windows onto it (`SLATES_HOST` in `~/.slates/.env`).

- SSH is key-only and tailnet-only: `ssh -i ~/.ssh/slates_pc email@100.79.163.21`. The default key and the Mac username are refused. SSH lands in cmd.exe: wrap commands in `powershell -NoProfile -Command "..."` (PowerShell 5.1), and for anything with pipes or regexes `scp` a `.ps1` over and run it with `powershell -NoProfile -ExecutionPolicy Bypass -File`, since cmd splits on `|` even inside quotes.
- The PC runs `node bin/slates.js host` from `C:\Users\email\slates` through the "Slates host" scheduled task (headless console). Log: `%USERPROFILE%\.slates\logs\host.log`.

## Deploying to the PC

1. Commit on the Mac. If `main` is pushed, run `git pull --ff-only` on the PC. If not, ship a bundle: `git bundle create /tmp/slates.bundle <pc-head>..main`, copy it over with `scp`, then on the PC run `git fetch <bundle> main` and `git merge --ff-only FETCH_HEAD`.
2. Restart: `node bin\slates.js host --stop`, then `Start-ScheduledTask -TaskName "Slates host"`. It reinstalls when the lockfile changed and rebuilds when HEAD changed (a few minutes of downtime), then logs "portal ready".
3. Check from the Mac: `curl -H "sec-fetch-site: same-origin" https://smaran.tail55de6b.ts.net/api/host`.

## Study Studio

Sets live in `~/.slates/study` on the host. `web/lib/study/gather.ts` reads the unit through the sync service (Materials folders and every subfolder of the matching unit, Pages and link views via `/course/page`, files via `/course/document` + `/course/file`); the study agent (`web/lib/study/agent.ts`) then researches with the Agent app's browser and tools. School-only Google files are read with the Agent browser's Google sign-in (`web/lib/study/google.ts`); the sync browser has no Google session. `npx tsx --test lib/study/*.test.ts` in `web/`.

## Working here

- In `web/`: `npx tsc --noEmit`, `npx eslint <paths>`, `npx tsx --test <file>.test.ts`.
- Several agent sessions may share this checkout. Commit only your own paths (`git commit -- <paths>`), check `git diff --cached` first, and never sweep up another session's staged changes.
- Never print values from `~/.slates/.env`; compare keys by hash.
