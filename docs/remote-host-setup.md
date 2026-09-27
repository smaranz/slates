# Running Slates' back end on another computer

The heavy part of Slates is the back end: the Next portal, the Schoology
scraper and the Chrome it drives, and the Claude Code / Cursor processes a
tutor reply spawns. Put all of that on a computer that stays on — a desktop or
gaming PC — and the laptop becomes just a window, and the phone app stops
needing the laptop at all.

```
Mac: Slates.app (window only) ─┐                 ┌─ 127.0.0.1:7528  portal
                               ├─ your tailnet ──┤
Phone: Slates app ─────────────┘  (HTTPS)        └─ 127.0.0.1:7529  scraper ─ Chrome ─ Schoology
                                  host: tailscale serve
```

Both services listen on `127.0.0.1` only. [Tailscale Serve](https://tailscale.com/kb/1312/serve)
is the one way in, and it only answers devices signed in to your tailnet. The
portal refuses requests that come from other websites (`web/proxy.ts`), but it
has **no login**: anything on your tailnet can use it as you. Don't publish it
with Funnel, ngrok, or a Cloudflare tunnel.

## 1. The host (Windows)

Use native Windows, not WSL — the scraper drives the installed Google Chrome,
and the Schoology sign-in needs a real window on the desktop.

1. Install [Node.js 22 LTS](https://nodejs.org), [Git](https://git-scm.com), and Google Chrome.

2. Clone the repo and give it your keys:

   ```powershell
   git clone https://github.com/smaranz/slates.git $env:USERPROFILE\slates
   New-Item -ItemType Directory -Force "$env:USERPROFILE\.slates" | Out-Null
   ```

   Copy your `~/.slates/.env` to `%USERPROFILE%\.slates\.env` (for example
   with `scp` from the Mac). `slates host` hands that file to both services;
   the portal doesn't read it on its own.

3. Start it once in a terminal:

   ```powershell
   cd $env:USERPROFILE\slates
   node bin\slates.js host
   ```

   The first run installs dependencies and builds the portal, which takes a few
   minutes. After that it starts both services, restarts either one if it
   exits, and logs to `%USERPROFILE%\.slates\logs\host.log`. `--stop` stops a
   running host; `--rebuild` forces a build.

4. Sign in to Schoology, at the PC — a Chrome window opens there:

   ```powershell
   cd $env:USERPROFILE\slates\scraper
   node login.mjs <your-district>.schoology.com
   ```

   A running host pauses its scraper for this and picks the session up when
   you're done. Google sign-in re-completes itself after that, so you should
   rarely need to do it again.

5. Sign the tutor's models in on this machine:

   ```powershell
   claude auth login                        # Claude models
   npm --prefix web run cursor:login        # Grok and Composer (not `cursor-agent login`)
   ```

6. Publish the portal to your tailnet. Install [Tailscale](https://tailscale.com/download/windows),
   sign in, then:

   ```powershell
   tailscale serve --bg 7528
   tailscale serve status     # prints https://<host>.<tailnet>.ts.net
   ```

7. Keep it running. Stop the PC sleeping on AC power, and start the host at
   log-on without a console window:

   ```powershell
   powercfg /change standby-timeout-ac 0

   $node = (Get-Command node).Source
   $slates = "$env:USERPROFILE\slates"
   # conhost --headless, not powershell -WindowStyle Hidden: with Windows
   # Terminal as the default console the latter opens a visible window, and
   # closing it stops Slates.
   $action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\conhost.exe" `
     -Argument "--headless `"$node`" `"$slates\bin\slates.js`" host" `
     -WorkingDirectory $slates
   $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
   $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
     -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1)
   Register-ScheduledTask -TaskName "Slates host" -Action $action -Trigger $trigger -Settings $settings -Force
   Start-ScheduledTask -TaskName "Slates host"
   ```

   The task only runs while you're logged in to Windows, since Chrome and the
   CLI logins belong to your account.

## 2. The Mac

1. Install [Tailscale](https://tailscale.com/download/mac) and sign in to the same tailnet.
2. Point Slates at the host:

   ```bash
   echo 'SLATES_HOST=https://<host>.<tailnet>.ts.net' >> ~/.slates/.env
   ```

3. Quit Slates and open it again. It starts nothing locally — no portal, no
   scraper, no Chrome — and copies your board to the new address the first
   time. Delete the line to go back to running everything on the Mac.

## 3. The phone

1. Install the Tailscale app and sign in to the same tailnet.
2. In `mobile/.env`:

   ```
   SLATES_MOBILE_SERVER_URL=https://<host>.<tailnet>.ts.net
   ```

3. `npm run check:server && npm run sync` in `mobile/`, then build and install
   from Xcode or Android Studio. It's HTTPS, so no plain-HTTP exceptions are
   needed, and it works away from home.

## Updating the host

```powershell
cd $env:USERPROFILE\slates
node bin\slates.js host --stop
git pull
Start-ScheduledTask -TaskName "Slates host"
```

`slates host` reinstalls dependencies when a lockfile changed and rebuilds the
portal when the commit changed. Only what's pushed reaches the host.

## Good to know

- Your marks, tutor chats and counselor record live in each device's browser
  storage, which is tied to the address. The Mac's copy is carried to the host's
  address once; the phone starts fresh there, and devices don't share them yet.
- AI Usage is hidden when the host isn't a Mac: it reads the host's coding-tool
  logs with macOS-only commands.
- Optional extras need installing on the host too: the essay AI detector
  (`npm --prefix web run detector:install`; without it the essay check uses
  local statistics) and lesson videos (ffmpeg and HyperFrames).
- When Schoology signs the scraper out, the board says so; run step 4 again at
  the PC.
- Trouble? Read `%USERPROFILE%\.slates\logs\host.log`, and check
  `curl http://127.0.0.1:7528/api/host` on the host.
