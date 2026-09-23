/**
 * The reference shelf: component libraries, icon sets and design galleries,
 * kept in one place so browsing them is one tab rather than thirty bookmarks.
 *
 * This file is a catalogue, not a copy. Every entry points at the library's own
 * site and Slates loads that site live — so what you see is always the current
 * version, the author keeps their traffic and their credit, and nothing here
 * depends on us having mirrored a component correctly. Several of these are
 * paid products (Nucleo, Hugeicons Pro, Iconsax), and most of the free ones are
 * separate design systems that would not survive being pasted into this app's
 * tokens anyway.
 *
 * Blurbs are written from each site's own description, checked against the live
 * page on 2026-09-19. All 33 answered 200.
 */

export type UiKind = "ai" | "components" | "effects" | "icons" | "inspiration";

export interface UiLibrary {
  name: string;
  url: string;
  /** One line, in our words, saying what you'd come here for. */
  blurb: string;
  kind: UiKind;
  /**
   * The site refuses to be framed — `X-Frame-Options`, or a CSP that names its
   * own origin as the only allowed ancestor. Slates strips those two headers
   * for these hosts inside its own isolated browsing session (see the
   * `persist:uilibs` block in desktop/main.mjs), which is the difference
   * between the pane rendering and a permanently blank rectangle.
   */
  needsFrameUnlock?: boolean;
  /** Says so on the card, so a paid set isn't mistaken for a free one. */
  paid?: boolean;
}

export const UI_KINDS: { id: UiKind; label: string; note: string }[] = [
  { id: "ai", label: "AI interfaces", note: "Chat, tool calls, thinking states, streaming" },
  { id: "components", label: "Component libraries", note: "Full React + Tailwind sets" },
  { id: "effects", label: "Effects & primitives", note: "One idea, done properly" },
  { id: "icons", label: "Icons", note: "Static and animated icon sets" },
  { id: "inspiration", label: "Inspiration", note: "Galleries and craft references" },
];

export const UI_LIBRARIES: UiLibrary[] = [
  /* ------------------------------------------------------------------ AI */
  {
    name: "Transitions.dev",
    url: "https://transitions.dev/",
    blurb: "The essential UI transitions for web apps, copy-paste or via an agent skill.",
    kind: "ai",
  },
  {
    name: "Beautiful UI",
    url: "https://www.beautifului.dev/",
    blurb:
      "Copy-paste primitives for chat agents, thinking states and human-in-the-loop approvals.",
    kind: "ai",
  },
  {
    name: "AICSS",
    url: "https://www.aicss.dev/",
    blurb:
      "Agent-conversation components — tool calls, streaming text, citations — in React, Vue and Svelte.",
    kind: "ai",
  },
  {
    name: "UI by Halaska",
    url: "https://ui.halaska.com/",
    blurb: "A single-file React kit on shadcn/ui: 38 UX patterns, around 100 components.",
    kind: "ai",
  },
  {
    name: "OpenUI",
    url: "https://www.openui.com/",
    blurb: "A streaming-first language for generative UI, renderer-agnostic with React support.",
    kind: "ai",
  },
  {
    name: "Astryx",
    url: "https://astryx.atmeta.com/",
    blurb: "Meta's open-source design system, customizable and built to be driven by agents.",
    kind: "ai",
  },

  /* ---------------------------------------------------------- components */
  {
    name: "beUI",
    url: "https://beui.dev/",
    blurb: "Free animated React and Next.js components built with Motion, via the shadcn CLI.",
    kind: "components",
  },
  {
    name: "Rare UI",
    url: "https://www.rareui.com/",
    blurb: "An open registry of unusual animated React components. Copy, paste, own the code.",
    kind: "components",
  },
  {
    name: "ObsidianUI",
    url: "https://www.obsidianui.dev/",
    blurb: "30+ React and Tailwind components, blocks and landing-page templates.",
    kind: "components",
  },
  {
    name: "ObsidianUI (preview)",
    url: "https://www.temp.obsidianui.dev/",
    blurb: "The staging build of ObsidianUI — same library, sometimes further ahead.",
    kind: "components",
  },
  {
    name: "coss ui",
    url: "https://coss.com/ui",
    blurb: "A modern component library built on Base UI, aimed at developers and agents.",
    kind: "components",
  },
  {
    name: "Spectrum UI",
    url: "https://ui.spectrumhq.in/",
    blurb: "Animation-ready React components and blocks for SaaS and AI apps.",
    kind: "components",
  },
  {
    name: "Great UI",
    url: "https://www.great-ui.com/",
    blurb: "Accessible copy-paste React components in TypeScript, Tailwind and Framer Motion.",
    kind: "components",
  },
  {
    name: "Bencho",
    url: "https://bencho.dev/",
    blurb: "Interactive UI blocks you can tweak in place — everything live, nothing mocked.",
    kind: "components",
    needsFrameUnlock: true,
  },
  {
    name: "Kobra",
    url: "https://kobra.systems/components/input-otp",
    blurb: "A segmented one-time-code input with every state designed, light and dark.",
    kind: "components",
  },

  /* ------------------------------------------------------------- effects */
  {
    name: "Beam",
    url: "https://libraries.dev/beam",
    blurb: "An animated glow that rides the border of any card, button or input.",
    kind: "effects",
  },
  {
    name: "Torph",
    url: "https://torph.lochie.me/",
    blurb: "Dependency-free animated text morphing.",
    kind: "effects",
  },
  {
    name: "Typehug",
    url: "https://typehug.aliszu.com/",
    blurb: "Non-breaking spaces done right, for plain text, HTML and formatted runs.",
    kind: "effects",
  },
  {
    name: "liquid-glass",
    url: "https://glass.samasante.com/",
    blurb: "A headless React lens that really refracts the live page, in every browser.",
    kind: "effects",
  },
  {
    name: "DialKit",
    url: "https://www.dialkit.dev/",
    blurb: "Live controls for tuning motion, layout and colour inside your own interface.",
    kind: "effects",
  },

  /* --------------------------------------------------------------- icons */
  {
    name: "Heroicons",
    url: "https://heroicons.com/",
    blurb: "Hand-crafted SVG icons from the Tailwind CSS team. MIT.",
    kind: "icons",
  },
  {
    name: "Lucide",
    url: "https://lucide.dev/icons/",
    blurb: "The community fork of Feather — a large, consistent, ISC-licensed set.",
    kind: "icons",
  },
  {
    name: "Tabler Icons",
    url: "https://tabler.io/icons",
    blurb: "6,200+ free open-source icons with adjustable size, colour and stroke.",
    kind: "icons",
    needsFrameUnlock: true,
  },
  {
    name: "lucide-animated",
    url: "https://lucide-animated.com/",
    blurb: "350+ animated React icons built on Lucide and Motion. MIT.",
    kind: "icons",
  },
  {
    name: "Moving Icons",
    url: "https://www.movingicons.dev/icons",
    blurb: "Beautifully crafted moving icons, for Svelte.",
    kind: "icons",
  },
  {
    name: "Hugeicons",
    url: "https://hugeicons.com/",
    blurb: "60,000+ icons across 10 styles. Free tier plus a paid Pro set.",
    kind: "icons",
    paid: true,
  },
  {
    name: "Iconsax",
    url: "https://app.iconsax.io/",
    blurb: "The Iconsax collection for designers and developers.",
    kind: "icons",
    paid: true,
  },
  {
    name: "Nucleo",
    url: "https://nucleoapp.com/",
    blurb: "40,000+ icons with web and native apps to manage them. Paid bundle.",
    kind: "icons",
    paid: true,
  },

  /* --------------------------------------------------------- inspiration */
  {
    name: "Kage",
    url: "https://kage.design/",
    blurb: "Interfaces from real products, each turnable into a prompt for a coding agent.",
    kind: "inspiration",
    needsFrameUnlock: true,
  },
  {
    name: "Detail",
    url: "https://detail.design/",
    blurb: "A reference of the small decisions that separate good interfaces from adequate ones.",
    kind: "inspiration",
  },
  {
    name: "Inspora",
    url: "https://www.inspora.design/",
    blurb: "A curated archive of recent visual and creative work.",
    kind: "inspiration",
  },
  {
    name: "CollectUI",
    url: "https://collectui.com/",
    blurb: "Daily UI design inspiration, curated from Dribbble.",
    kind: "inspiration",
  },
];

/** Hosts Slates will unlock framing for — the allowlist main.mjs reads. */
export const FRAME_UNLOCK_HOSTS = UI_LIBRARIES.filter((l) => l.needsFrameUnlock).map(
  (l) => new URL(l.url).hostname
);

export function searchLibraries(query: string): UiLibrary[] {
  const q = query.trim().toLowerCase();
  if (!q) return UI_LIBRARIES;
  return UI_LIBRARIES.filter(
    (l) =>
      l.name.toLowerCase().includes(q) ||
      l.blurb.toLowerCase().includes(q) ||
      l.kind.includes(q)
  );
}
