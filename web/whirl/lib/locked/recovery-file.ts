"use client";

import { formatRecoveryCode, normalizeRecoveryCode } from "./crypto";

/* The recovery key, as a file a person can keep and later hand back.

   Plain text on purpose: it has to survive being printed, pasted into a
   password manager, or opened on a machine that has nothing installed. The
   preamble is there so that finding this file in a downloads folder two
   years from now tells you what it is and what to do with it. */

const FILE_HEADER = "Whirl locked chat — recovery key";

/** The file's contents for one thread's recovery key. */
export function recoveryFileContents({
  code,
  threadName,
  createdAt,
}: {
  code: string;
  threadName: string;
  createdAt: Date;
}): string {
  return [
    FILE_HEADER,
    "=".repeat(FILE_HEADER.length),
    "",
    `Chat:    ${threadName}`,
    `Created: ${createdAt.toLocaleString()}`,
    "",
    "Recovery key:",
    "",
    `    ${formatRecoveryCode(code)}`,
    "",
    "Use this key if you forget the password.",
    "",
    "Whirl stores this chat encrypted. Whirl has no copy of the password and",
    "no copy of this key. If you lose both, you cannot read the chat again.",
    "",
    "Keep this file in a safe place. Any person with this key can read the",
    "chat.",
    "",
  ].join("\n");
}

/** A filename that sorts sensibly and says what it is at a glance. */
export function recoveryFileName(threadName: string, createdAt: Date): string {
  const slug =
    threadName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "locked-chat";
  const stamp = createdAt.toISOString().slice(0, 10);
  return `whirl-recovery-key-${slug}-${stamp}.txt`;
}

/** Hand the file to the browser. The object URL is revoked on the next
 *  frame — the download has already started by then, and leaving it around
 *  pins the blob for the life of the tab. */
export function downloadRecoveryKey(args: {
  code: string;
  threadName: string;
}) {
  const createdAt = new Date();
  const blob = new Blob([recoveryFileContents({ ...args, createdAt })], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = recoveryFileName(args.threadName, createdAt);
  link.click();
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

/** Pull a recovery key out of an uploaded file. The file we wrote is one
 *  shape, but someone pasting the key into a note is another — so this looks
 *  for the first run of the right length anywhere in the text rather than
 *  insisting on our own layout. */
export function readRecoveryKeyFromFile(
  contents: string,
  expectedLength: number,
): string | null {
  for (const line of contents.split(/\r?\n/)) {
    const candidate = normalizeRecoveryCode(line);
    if (candidate.length === expectedLength) return candidate;
  }
  // Last resort: the whole file, in case the key was wrapped across lines.
  const whole = normalizeRecoveryCode(contents);
  return whole.length === expectedLength ? whole : null;
}
