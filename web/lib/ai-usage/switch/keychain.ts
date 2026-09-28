import "server-only";

import { execFile, spawn } from "node:child_process";

/**
 * The login keychain, through /usr/bin/security — the same way Claude Code and
 * agy (go-keyring) reach it, so the items they created open without a prompt.
 */

const SECURITY = "/usr/bin/security";

/** `security -i` reads commands a line at a time from a buffer of about 4 KB, and cuts longer ones short. */
const INTERACTIVE_LINE_MAX = 3_900;

function quote(s: string): string {
  return `"${s.replace(/(["\\])/g, "\\$1")}"`;
}

/** Waiting longer only makes sense when someone has been asked to answer a macOS prompt. */
export function readSecret(service: string, account?: string, timeoutMs = 8_000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(SECURITY, ["find-generic-password", "-s", service, ...(account ? ["-a", account] : []), "-w"], { timeout: timeoutMs, maxBuffer: 1 << 20 }, (err, out) =>
      resolve(err ? null : out.replace(/\n$/, "") || null)
    );
  });
}

function interactive(line: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(SECURITY, ["-i"], { stdio: ["pipe", "ignore", "ignore"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    child.stdin.end(`${line}\n`);
  });
}

function direct(args: string[]): Promise<boolean> {
  return new Promise((resolve) => execFile(SECURITY, args, { timeout: 10_000 }, (err) => resolve(!err)));
}

/**
 * Creates or replaces an item. The value goes as hex, on stdin when the line
 * fits and as an argument when it doesn't (a Claude login is too long). An
 * argument is only readable by this user and root on macOS, and this user can
 * read the item itself anyway, so it gives nothing away. The item is read back
 * to be sure it holds exactly the value, since a cut-short line still succeeds.
 */
export async function writeSecret(service: string, account: string, value: string): Promise<void> {
  const hex = Buffer.from(value, "utf8").toString("hex");
  const line = `add-generic-password -U -s ${quote(service)} -a ${quote(account)} -X ${hex}`;
  const ok = line.length <= INTERACTIVE_LINE_MAX ? await interactive(line) : await direct(["add-generic-password", "-U", "-s", service, "-a", account, "-X", hex]);
  if (!ok || (await readSecret(service, account)) !== value) {
    throw new Error("macOS didn't let Slates save to the keychain. Allow it if it asks, then try again.");
  }
}

export async function removeSecret(service: string, account: string): Promise<void> {
  await interactive(`delete-generic-password -s ${quote(service)} -a ${quote(account)}`);
}
