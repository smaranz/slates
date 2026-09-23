# Running Slates' back end on the gaming PC

The Mac becomes just the window. The PC runs the Next portal, the Schoology
scraper and its Chrome, and the Claude Code / Cursor CLIs a tutor reply shells
out to. That is the part that was eating RAM.

**Run this on native Windows, not inside WSL.** The environment probe on the
PC settled it:

- The Claude Code session that can actually run commands is native Windows
  (Git Bash), not a session inside Ubuntu.
- The scraper launches the **installed** Chrome (`channel: "chrome"` in
  `scraper/browser.mjs`). That Chrome is missing inside WSL. On Windows it is
  the Chrome already on the gaming PC, so the one-time Schoology login is a
  normal window, not a WSLg one.
- WSL2 (`Ubuntu-24.04`) is installed and WSLg works, but that distro only
  sees 4 CPUs and about 7 GB. The PC has 12 logical CPUs and about 31 GB.
  Putting the portal in WSL would leave most of the machine idle.
- The repo is not cloned yet, so nothing is invested in a WSL checkout.
- Node and the portal do not shell out to `/bin/sh`. `os.homedir()` is what
  they use for `~/.slates`, which on Windows is `%USERPROFILE%\.slates`.

Leave the Ubuntu distro stopped. Do not install Chrome or Tailscale inside it.

## Do this first

Claude Code is already installed on the PC — that is the session the probe
came from. Stay in that native Windows session and have it run the steps
below. Remote Control is how the Mac talks to it. SSH from the Mac is blocked
by the harness, so this session is the path.

Cursor's CLI is separate and still has to be installed (section 4). The tutor
shells out to whichever CLI the chosen model uses, and those logins are per
machine.

---

## 1. Node and the repo

In PowerShell:

```powershell
winget install --id OpenJS.NodeJS.22 -e --accept-package-agreements
winget install --id Git.Git -e --accept-package-agreements
```

Open a new terminal so `node` and `git` are on `PATH`, then:

```powershell
git clone https://github.com/smaranz/slates.git $env:USERPROFILE\slates
cd $env:USERPROFILE\slates
npm --prefix web install
npm --prefix scraper install
```

`origin/main` is what this clone gets. Work that only exists on the Mac and
has not been pushed will not be on the PC.

## 2. Chrome

Confirm the Windows install, not a WSL one:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --version
```

If that prints a version, the scraper can launch. Do not install
`google-chrome` inside Ubuntu.

## 3. Your keys

The portal reads `%USERPROFILE%\.slates\.env`. Copy the values from the Mac's
`~/.slates/.env`.

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.slates" | Out-Null
@'
OPENAI_API_KEY=
OPENROUTER_API_KEY=
ELEVENLABS_API_KEY=
NEXT_PUBLIC_SLATES_EXTENSION_ID=
NEXT_PUBLIC_DESMOS_API_KEY=
'@ | Set-Content -Encoding utf8 "$env:USERPROFILE\.slates\.env"
```

Fill the values in before starting the portal. An empty file starts the app
and then fails every model call.

## 4. Cursor CLI

Claude Code is already signed in on this PC. Cursor is not:

```powershell
irm https://cursor.com/install | iex
cursor-agent login
```

If you skip this, the portal starts and every Grok or Composer reply fails.

## 5. Build and run

```powershell
cd $env:USERPROFILE\slates
npm --prefix web run build
```

Two long-lived processes, both bound to localhost. Leave each in its own
window (or use `pm2` if you want them to survive logoff). There is no
systemd on Windows.

```powershell
# window 1
cd $env:USERPROFILE\slates\scraper
node serve.mjs

# window 2
cd $env:USERPROFILE\slates\web
$env:PORT = "7528"
$env:HOSTNAME = "127.0.0.1"
node .next\standalone\server.js
```

```powershell
(Invoke-WebRequest http://127.0.0.1:7528/ -UseBasicParsing).StatusCode   # 200
```

## 6. Sign in to Schoology, once

```powershell
cd $env:USERPROFILE\slates\scraper
node login.mjs
```

A real Chrome window opens on the Windows desktop. Sign in there. The session
is saved under `%USERPROFILE%\.slates\chrome-profile` and reused headlessly
after that.

When Schoology later expires the session, that window appears **on the PC**,
not the Mac.

## 7. Tailscale

Install the Windows Tailscale app, not the Linux one inside WSL. Sign in to
the same tailnet as the Mac. Then, from a terminal:

```powershell
tailscale serve --bg 7528
tailscale serve status
```

`status` prints the `https://<host>.<tailnet>.ts.net` URL. Serve publishes to
**your tailnet only**. Do not use Funnel, ngrok, or a Cloudflare tunnel. The
portal has no login, and the scraper holds a live Schoology session.

The scraper stays on `127.0.0.1:7529` on the PC and is never published. Only
the portal talks to it.

## 8. Point the Mac at it

On the **Mac**:

```bash
echo 'SLATES_HOST=https://<host>.<tailnet>.ts.net' >> ~/.slates/.env
```

Quit Slates and open it again. It spawns nothing — no portal, no scraper, no
Chrome, no CLIs. The boot screen says it is connected to that host and loads
the remote portal.

Delete that line to go back to running everything on the Mac.

---

## Keeping it up

- The PC has to be awake. Tailscale cannot wake a sleeping machine from
  somewhere else. Turn sleep off, or the portal is down whenever the PC sleeps.
- The two `node` windows die when you close them. A logon task or `pm2` is
  what makes them survive a reboot.

## What you should expect

- The board comes across on first connect. Assignments, tutor chats, the
  student record, and Study Studio modules live in the window's
  `localStorage`, which is keyed by origin. `http://localhost:7528` and
  `https://<host>.ts.net` are different origins, so this would otherwise open
  empty. `migrateStorageToRemote()` in `desktop/main.mjs` copies it once, per
  host, and never overwrites a key the remote origin already has. The local
  copy is left in place, so removing `SLATES_HOST` puts you back where you were.
- Replies are a little slower over a tailnet than over loopback.
- The Mac still runs a Chromium window. What you stop paying for is Node, the
  scraper's Chrome, and whatever a tutor reply spawns.
