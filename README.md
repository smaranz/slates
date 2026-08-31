<div align="center">

<img src="web/public/assets/slates-icon.png" width="128" alt="Slates">

# SLATES

**Schoology, rebuilt as a workspace.**

Every assignment, quiz, and grade on one board — plus the hours you actually burn on each.

[![License: MIT](https://img.shields.io/badge/license-MIT-3d3d3d?style=flat-square)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-000?style=flat-square&logo=nextdotjs)](https://nextjs.org)
[![Electron](https://img.shields.io/badge/desktop-macOS-3d3d3d?style=flat-square)](desktop)

</div>

---

Schoology is a filing cabinet. Slates is the desk.

You get a native-feeling dark board for tonight's work, a gradebook that projects the letter you will actually get, a calendar that does not lie about due dates, a tutor that has read the assignment, and a timer that tracks what the LMS will never measure: **time spent**.

No more twenty tabs. No more "I thought I turned that in."

<p align="center">
  <img src="web/public/assets/slates-mark.png" width="40" alt="">
</p>

## What you get

| Surface | What it does |
| --- | --- |
| **Board** | Tonight / next up / this week. Impact, time estimate, done. |
| **Grades** | Live categories, custom scores, projected letter. |
| **Calendar** | Due dates as they exist, not as the homepage implied. |
| **Tutor** | GPT, Claude, Grok, Composer, DeepSeek, GLM, Qwen, Gemini. Attach the PDF. |
| **Messages** | Inbox without the rest of the LMS. |
| **Timer** | Start / stop on the assignment. The hours are yours. |

Quizzes and Drive handoffs stay on the real Schoology page. Slates overlays the tracker. The attempt stays where the teacher configured it — we do not reimplement a server-side timer and gamble your grade.

## How it is built

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│  Slates UI  │────▶│  local scrape │────▶│  Schoology, as   │
│  Next.js    │     │  Playwright   │     │  you signed in   │
└─────────────┘     └──────────────┘     └──────────────────┘
       │
       └── desktop shell (Electron) starts both. One icon. Quit kills everything.
```

The portal has no Schoology cookie. A dedicated Chrome profile stays logged in and reads the fully rendered pages. Submissions are verified against the revision list — a Drupal `200` means nothing; a new revision means it landed.

```
web/         Next.js 16 portal
scraper/     logged-in Playwright browser
desktop/     Electron — one process tree
extension/   optional Chrome bridge
```

## Run it

```bash
git clone https://github.com/smaranz/slates.git
cd slates

# portal
cd web
cp .env.example .env.local   # drop in keys
npm install
npm run dev                  # http://localhost:3000

# scraper — second terminal
cd ../scraper
npm install
npx playwright install chromium
npm run serve                # leave this running
```

Then **Settings → Sync now**. Sample data is there until the scraper answers.

### Desktop

```bash
cd desktop
npm install
npm run dev                  # attaches to the Next server you already started
```

Packaged build: `npm run dist` (macOS arm64).

### Keys

| Variable | Who needs it |
| --- | --- |
| `OPENAI_API_KEY` | GPT tutor + estimates |
| `OPENROUTER_API_KEY` | DeepSeek, GLM, Qwen, Gemini |
| Claude | `claude auth login` — no key in the env |
| Grok / Composer | `cd web && npm run cursor:login` |

See [`web/.env.example`](web/.env.example).

## Rules of the road

This reads and writes **your** account. PowerSchool's terms are not friendly to automation. Keep it personal, single-account, and polite on the wire.

MIT. Take it, fork it, make it meaner.

<p align="center">
  <img src="web/public/assets/slates-mark.png" width="28" alt="Slates">
</p>
