# Skills the tutor can use

Agent Skills the Slates tutor loads when it's running on a Claude model. Each
folder is a skill in the standard layout — a `SKILL.md` of instructions, plus
whatever scripts and assets it needs.

Only the `claude-code` backend can actually *run* these. On the OpenAI,
OpenRouter, and Cursor backends the tutor gets the skill's guidance folded into
its prompt instead, so a document comes out structured the same way but as
text in the chat rather than a file on disk. See `web/lib/tutor-skills.ts`.

## What's here

| Skill | License | Why the tutor has it |
| --- | --- | --- |
| `canvas-design` | Apache-2.0 | Posters, one-pagers, and other visual project work as PNG/PDF. |
| `theme-factory` | Apache-2.0 | Consistent styling for anything the tutor produces. |
| `math-olympiad` | Apache-2.0 | Hard problem solving, with adversarial verification rather than self-checking — self-verified proofs agree with themselves far too readily. |

All three are vendored from Anthropic's public repositories under Apache 2.0,
with each skill's own `LICENSE.txt` kept alongside it:

- `canvas-design`, `theme-factory` — https://github.com/anthropics/skills
- `math-olympiad` — https://github.com/anthropics/claude-plugins-official

## What is deliberately *not* here

Anthropic's `docx`, `pdf`, `pptx`, and `xlsx` skills — the ones behind Claude's
own file creation — are **source-available, not open source**. Their licence
forbids retaining copies outside Anthropic's services, reproducing them,
creating derivative works, and distributing them to third parties. Vendoring
them into a public repository would breach all four, so Slates ships without
them.

The tutor still picks them up if *you* have them, because skill discovery
includes your personal `~/.claude/skills/` alongside this directory. Installing
them there is a decision about your own agreement with Anthropic:

    https://github.com/anthropics/skills

Without them the tutor writes documents into the chat instead of producing a
`.docx` — everything else works unchanged.

## Adding another skill

Drop the folder in here. It's discovered automatically; nothing in Slates
enumerates skills by name. Keep its `LICENSE.txt`, and check that the licence
actually permits redistribution before committing it — the four skills above
are a reminder that "public on GitHub" and "free to vendor" are different
things.
