import type { MentionTarget } from "@whirl/lib/integrations";

/* Inline mention plumbing. Mentions live in the composer text as literal
   "@Name" runs — derived on every render, never stored — and the pieces
   here turn that string into segments (for the chip backdrop), ranges
   (for the one-character caret behavior), and a deduped list (for the
   send payload). Ported from v1's composer-mentions with the same
   matching rules. */

/** One run of composer text: either plain, or an "@Name" mention token. */
export type MentionSegment = {
  text: string;
  mention?: MentionTarget;
};

/** A mention token's position in the raw text: [start, end). */
export type MentionRange = {
  start: number;
  end: number;
  mention: MentionTarget;
};

/**
 * Split composer text into plain runs and "@Name" mention tokens. A token
 * counts only when the "@" sits at a word boundary and what follows matches
 * a mentionable's name (case-insensitive, longest name first, and not
 * bleeding into a longer word — "@Notion" in "@Notions" doesn't match). The
 * typed text is preserved verbatim; editing half a name simply demotes the
 * token back to plain text.
 */
export function splitMentionSegments(
  text: string,
  mentionables: MentionTarget[],
): MentionSegment[] {
  if (!text || mentionables.length === 0) return text ? [{ text }] : [];
  /* No "@" anywhere means no token can exist, and this runs on every
     keystroke — worth skipping the char-by-char walk for the common draft. */
  if (!text.includes("@")) return [{ text }];
  const byLength = [...mentionables].sort(
    (a, b) => b.name.length - a.name.length,
  );
  const segments: MentionSegment[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    const boundary = i === 0 || /\s/.test(text[i - 1]);
    if (text[i] === "@" && boundary) {
      const rest = text.slice(i + 1);
      const restLower = rest.toLowerCase();
      const match = byLength.find((m) => {
        if (!restLower.startsWith(m.name.toLowerCase())) return false;
        const next = rest[m.name.length];
        return next === undefined || !/[\p{L}\p{N}]/u.test(next);
      });
      if (match) {
        if (plain) {
          segments.push({ text: plain });
          plain = "";
        }
        segments.push({
          text: text.slice(i, i + 1 + match.name.length),
          mention: match,
        });
        i += 1 + match.name.length;
        continue;
      }
    }
    plain += text[i];
    i += 1;
  }
  if (plain) segments.push({ text: plain });
  return segments;
}

/** The segments' mention tokens with their absolute text positions. */
export function mentionRanges(segments: MentionSegment[]): MentionRange[] {
  const ranges: MentionRange[] = [];
  let pos = 0;
  for (const segment of segments) {
    if (segment.mention) {
      ranges.push({
        start: pos,
        end: pos + segment.text.length,
        mention: segment.mention,
      });
    }
    pos += segment.text.length;
  }
  return ranges;
}

/** The targets mentioned in the text, deduped, in order of appearance. */
export function findMentionedTargets(
  text: string,
  mentionables: MentionTarget[],
): MentionTarget[] {
  const seen = new Set<string>();
  const out: MentionTarget[] = [];
  for (const segment of splitMentionSegments(text, mentionables)) {
    if (!segment.mention || seen.has(segment.mention.serverId)) continue;
    seen.add(segment.mention.serverId);
    out.push(segment.mention);
  }
  return out;
}
