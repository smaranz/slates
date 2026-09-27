# Running Slates' back end on another computer

The heavy part of Slates is the back end: the Next portal, the Schoology
scraper and the Chrome it drives, and the Claude Code / Cursor processes a
tutor reply spawns. Put all of that on a computer that stays on — a desktop or
gaming PC — and the laptop becomes just a window, and the phone app stops
needing the laptop at all.

```
Mac: Slates.app (window only) ─┐   tailnet, or the     ┌─ 127.0.0.1:7528  portal
                               ├─ internet (HTTPS) ────┤
Phone: Slates app ─────────────┘                       └─ 127.0.0.1:7529  scraper ─ Chrome ─ Schoology
                                  host: tailscale funnel
```

Both services listen on `127.0.0.1` only, and Tailscale is the one way in.
[Tailscale Funnel](https://tailscale.com/kb/1223/funnel) publishes the portal
at `https://<host>.<tailnet>.ts.net` to the internet as well as your tailnet,
so the laptop and phone don't need Tailscale running — but only **paired
devices** get in (`web/proxy.ts`, `web/lib/devices.ts`):

- A device pairs itself the first time it opens Slates over Tailscale. Tailscale
  vouches for your account there, so Slates hands the device a 256-bit key, kept
  as a cookie. From then on it works with Tailscale off.
- Anything reaching the portal through Tailscale without a key gets a "not
  paired" page. Settings › General › Devices lists paired devices and forgets a
  lost one.
- Requests from the host itself need no key. That's why nothing but Tailscale
  may publish the portal: another tunnel (ngrok, Cloudflare) would look like the
  host and skip the lock.

The portal also refuses requests that come from other websites.

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

6. Publish the portal. Install [Tailscale](https://tailscale.com/download/windows),
   sign in, then:

   ```powershell
   tailscale funnel --bg 7528
   tailscale funnel status    # https://<host>.<tailnet>.ts.net (Funnel on)
   ```

   The first time, Tailscale may ask you to allow Funnel for your tailnet. To
   keep it tailnet-only instead, use `tailscale serve --bg 7528`; devices then
   always need Tailscale on.

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

3. Quit Slates and open it again, with Tailscale on this once so the Mac gets
   paired. It starts nothing locally — no portal, no scraper, no Chrome — and
   copies your board to the new address the first time. After that Tailscale can
   stay off. Delete the line to go back to running everything on the Mac.
4. For coding agents on the Mac (the `slates-ui` MCP server), give them a key of
   their own while on Tailscale:
   `curl -s -X POST https://<host>.<tailnet>.ts.net/api/devices -d '{"name":"Mac coding agents"}'`,
   and put the `key` it returns in `~/.slates/.env` as `SLATES_HOST_TOKEN=`.

## 3. The phone

1. Install the Tailscale app and sign in to the same tailnet.
2. In `mobile/.env`:

   ```
   SLATES_MOBILE_SERVER_URL=https://<host>.<tailnet>.ts.net
   ```

3. `npm run check:server && npm run sync` in `mobile/`, then build and install
   from Xcode or Android Studio. It's HTTPS, so no plain-HTTP exceptions are
   needed, and it works away from home.
4. Open it once with Tailscale on to pair the phone; after that it works with
   Tailscale off.

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
- AI Usage reads coding-tool logs with macOS-only commands, so it follows the
  Mac rather than the host. The Mac's desktop app shows it from the Mac itself,
  starting a small portal there only while AI Usage is in use, and counts
  Slates' own AI calls from the host's ledger. On the phone, or in a browser
  pointed at a host that isn't a Mac, it's hidden.
- Optional extras need installing on the host too: the essay AI detector and
  lesson videos (ffmpeg and HyperFrames). On Windows the detector installs with
  `powershell -ExecutionPolicy Bypass -File detector\install.ps1 -Gpu gfx1200`,
  which runs it on an AMD Radeon through ROCm (`-Gpu cpu` without one); without
  it the essay check uses local statistics.
- When Schoology signs the scraper out, the board says so; run step 4 again at
  the PC.
- Trouble? Read `%USERPROFILE%\.slates\logs\host.log`, and check
  `curl http://127.0.0.1:7528/api/host` on the host.
