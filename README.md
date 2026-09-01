<div align="center">

<img src="web/public/assets/slates-icon.png" width="120" alt="Slates">

# SLATES

### Schoology, rebuilt as a workspace.

**A board that plans your night. A gradebook that tells the truth. A tutor that actually read the assignment.**

[![License: MIT](https://img.shields.io/badge/license-MIT-3d3d3d?style=flat-square)](LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](web/tsconfig.json)
[![Electron](https://img.shields.io/badge/desktop-Electron-47848f?style=flat-square&logo=electron&logoColor=white)](desktop)
[![Playwright](https://img.shields.io/badge/sync-Playwright-2ead33?style=flat-square&logo=playwright&logoColor=white)](scraper)

<br>

<img src=".github/readme/board.png" width="860" alt="Slates board — Today, Tomorrow, This week, and Turned in, laid out as columns of cards with impact and time estimates">

</div>

<br>

Schoology is a filing cabinet. Every class is a different drawer, every due date is a click deep, and the homepage lies about what's actually due tonight.

**Slates is the desk.** One dark, fast, native-feeling board that pulls your real assignments, real grades, and real due dates out of Schoology and lays them flat — plus the one number the LMS was never built to track: **the hours you actually burned.**

No more twenty tabs. No more "I thought I turned that in."

<br>

## Everything on one board

<table>
<tr>
<td width="50%" valign="top">

**📋 Board**
Tonight / tomorrow / this week / turned in. Every card carries its real impact, a time estimate, and one honest due date — dragged into place by hand outranks anything auto-sorted.

**📊 Grades**
Live category math, not Schoology's cached percentage. Type in a hypothetical score for any real assignment and watch the projected grade move *before* the test happens, not after.

**📅 Calendar**
Due dates as they exist on the assignment page, not as the homepage implied three weeks ago.

</td>
<td width="50%" valign="top">

**⏱️ Timer**
Start it, close the laptop, come back — it's still counting. The one metric no LMS on Earth will ever show you: where your hours actually went.

**✉️ Messages**
The inbox, with none of the rest of the LMS dragged in behind it.

**🖇️ Live overlay**
Quizzes and Drive handoffs stay on the *real* Schoology page — Slates overlays the tracker on top. We don't reimplement a server-side timer and gamble your grade on it.

</td>
</tr>
</table>

<div align="center">
<img src=".github/readme/grades.png" width="860" alt="Slates grades view — a course's category breakdown, a grade-over-time chart, and every recent score with its impact on the grade">
</div>

<br>

## The tutor doesn't just chat

Ask it a question and it answers in four sentences, like a person who respects your time. Ask it for *work*, and it stops talking and starts building — right there in the thread, not as a promise to "here's an outline you could use."

<table>
<tr>
<td width="50%" valign="top" align="center">
<img src=".github/readme/tutor-studyguide.png" width="420" alt="The tutor writing a full study guide with a live embedded Desmos graph">
<br><sub><b>A study guide it wrote, with a graph it drew — not described.</b></sub>
</td>
<td width="50%" valign="top" align="center">
<img src=".github/readme/tutor-quiz.png" width="420" alt="The tutor generating a graded practice quiz with a graphing question">
<br><sub><b>Practice questions from the actual unit, graded on the spot.</b></sub>
</td>
</tr>
</table>

- **Study guides & documents** — full markdown, copy or download as `.md`, not crammed into a chat bubble.
- **Live graphs** — a real, pannable Desmos calculator embedded inline, in chat, inside a study guide, or attached to a question. Asked for a parabola, you get a parabola you can drag, not a paragraph describing one.
- **Practice tests** — multiple choice with instant grading and an explanation, free-response with a rubric and on-demand AI feedback on *your* answer.
- **Narrated teaching videos** — script, voice, and visuals composed into an actual MP4 for a concept worth walking through slowly.
- **Board actions** — "mark that done," "move it to tonight," "start the timer" — said in plain English, executed on the real board.
- **Nine model families** — GPT, Claude, Grok, Composer, DeepSeek, GLM, Qwen, Gemini, MiniMax. Attach a photo of the handout. Every thread persists — leave to check an assignment, the conversation is exactly where you left it.

<br>

## How it's built

```
┌──────────────┐      ┌───────────────┐      ┌───────────────────┐
│  Slates UI   │─────▶│  local scrape  │─────▶│    Schoology,      │
│  Next.js 16  │      │   Playwright   │      │  as you signed in  │
└──────────────┘      └───────────────┘      └───────────────────┘
       │
       └── desktop shell (Electron) starts both. One icon. Quit kills everything.
```

The portal itself holds **no Schoology cookie.** A dedicated, logged-in Chrome profile does the reading; the portal only ever talks to `localhost`. Every submission is verified against the page's own revision list afterward — a `200` from Schoology's backend means nothing on its own; a new revision in the list means it actually landed.

| Path | What lives there |
| --- | --- |
| [`web/`](web) | The Next.js 16 portal — board, grades, tutor, everything you look at |
| [`scraper/`](scraper) | The logged-in Playwright browser that does the actual reading and writing |
| [`desktop/`](desktop) | Electron shell — one process tree, one dock icon, one quit |
| [`extension/`](extension) | Optional Chrome bridge for handing the scraper your session |

<br>

## Run it

```bash
git clone https://github.com/smaranz/slates.git
cd slates

# portal
cd web
cp .env.example .env.local   # drop in whatever keys you have
npm install
npm run dev                  # http://localhost:3000

# scraper — second terminal
cd ../scraper
npm install
npx playwright install chromium
npm run serve                # leave this running
```

Open the portal, then **Settings → Sync now**. Sample data holds the fort until the scraper answers.

### Desktop app

```bash
cd desktop
npm install
npm run dev    # attaches to the Next server you already started
npm run dist   # packaged build (macOS arm64)
```

### Keys

Every key is optional in isolation — the app runs on sample data with none of them, and each feature just degrades gracefully to "not configured" until you add its key.

| Variable | Unlocks |
| --- | --- |
| `OPENAI_API_KEY` | GPT tutor models + assignment time estimates |
| `OPENROUTER_API_KEY` | DeepSeek, GLM, Qwen, Gemini, MiniMax |
| `NEXT_PUBLIC_DESMOS_API_KEY` | Live, interactive graphs from the tutor |
| `ELEVENLABS_API_KEY` | Narration for AI-generated teaching videos |
| `NEXT_PUBLIC_SLATES_EXTENSION_ID` | Real Schoology sync (unset = sample data) |
| Claude | `claude auth login` — no key lives in the env |
| Grok / Composer | `cd web && npm run cursor:login` |

Full reference: [`web/.env.example`](web/.env.example).

<br>

## Rules of the road

This reads and writes **your own** Schoology account, and nobody else's. PowerSchool's terms aren't friendly to automation — keep it personal, single-account, and polite on the wire. Don't point it at an account that isn't yours.

<br>

<div align="center">

MIT. Take it, fork it, make it meaner.

<img src="web/public/assets/slates-mark.png" width="26" alt="Slates">

</div>
