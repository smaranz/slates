import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The devices allowed to reach this Slates from outside its own machine.
 *
 * Slates is published to the internet through Tailscale Funnel so a laptop or
 * phone doesn't need Tailscale running, and nothing may get in that way without
 * a device key. A device earns one by visiting once over Tailscale itself —
 * a WireGuard connection Tailscale has already tied to the student's account —
 * or by typing a one-time code a paired device shows, and keeps it as a
 * cookie. Keys are 256-bit random; only their SHA-256 is stored, under
 * ~/.slates/devices.json on the host.
 */

export const DEVICE_COOKIE = "slates_device";
/** Browsers cap cookie lifetimes near 400 days; each visit renews it. */
export const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;
export const DEVICE_COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: DEVICE_COOKIE_MAX_AGE } as const;

export interface Device {
  id: string;
  name: string;
  hash: string;
  createdAt: number;
  lastSeen: number;
}

interface Registry {
  /** The Tailscale login that paired the first device; only it can pair more. */
  owner?: string;
  devices: Device[];
}

const file = () => path.join(os.homedir(), ".slates", "devices.json");
const KEY = /^([a-f0-9]{16})\.([A-Za-z0-9_-]{43})$/;
const hashOf = (secret: string) => createHash("sha256").update(secret).digest("hex");

const memory = globalThis as typeof globalThis & {
  __slatesDevices?: { mtime: number; checkedAt: number; registry: Registry };
  /** A just-issued key, reused for the same login and browser for a few minutes so parallel first requests don't each pair a device. */
  __slatesFreshKeys?: Map<string, { key: string; device: Device; at: number }>;
  /** The pairing code on offer: its hash, when it lapses, and the wrong tries it has taken. */
  __slatesPairing?: { hash: string; expiresAt: number; misses: number };
};

function read(): Registry {
  const now = Date.now();
  const cached = memory.__slatesDevices;
  if (cached && now - cached.checkedAt < 2_000) return cached.registry;
  let mtime = 0;
  try {
    mtime = fs.statSync(file()).mtimeMs;
  } catch {
    // No devices yet.
  }
  if (cached && cached.mtime === mtime) {
    cached.checkedAt = now;
    return cached.registry;
  }
  let registry: Registry = { devices: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), "utf8")) as Registry;
    if (Array.isArray(parsed.devices)) registry = parsed;
  } catch {
    // Missing or unreadable: no devices, which locks everything outside the host.
  }
  memory.__slatesDevices = { mtime, checkedAt: now, registry };
  return registry;
}

function write(registry: Registry): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const temporary = `${file()}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(registry, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file());
  memory.__slatesDevices = { mtime: fs.statSync(file()).mtimeMs, checkedAt: Date.now(), registry };
}

/** The device a key belongs to, or null. Compares in constant time. */
export function verifyKey(key: string | null | undefined): Device | null {
  const match = KEY.exec(key ?? "");
  if (!match) return null;
  const device = read().devices.find((entry) => entry.id === match[1]);
  if (!device) return null;
  const stored = Buffer.from(device.hash, "hex");
  const given = Buffer.from(hashOf(match[2]!), "hex");
  return stored.length === given.length && timingSafeEqual(stored, given) ? device : null;
}

/** Whether a Tailscale-verified login may use Slates: the owner, or anyone before a first device is paired. */
export function isOwner(login: string): boolean {
  const owner = read().owner;
  return !owner || owner === login;
}

function addDevice(name: string, owner?: string): { key: string; device: Device } {
  const registry = read();
  const secret = randomBytes(32).toString("base64url");
  const now = Date.now();
  const device: Device = { id: randomBytes(8).toString("hex"), name: name.trim().slice(0, 60), hash: hashOf(secret), createdAt: now, lastSeen: now };
  write({ owner: registry.owner ?? owner, devices: [...registry.devices, device].slice(-50) });
  return { key: `${device.id}.${secret}`, device };
}

/**
 * A key for something that isn't a browser — the Mac's coding agents, a
 * script. Only callers already on the host or the tailnet may ask (the route
 * checks); a paired device adds others with a pairing code instead.
 */
export function mintKey(name: string): { key: string; device: Device } {
  return addDevice(name.trim() || "Script");
}

/** Pair a device for a Tailscale-verified login. Null when that login isn't the owner. */
export function enroll(login: string, userAgent: string, name?: string): { key: string; device: Device } | null {
  if (!isOwner(login)) return null;

  const fresh = (memory.__slatesFreshKeys ??= new Map());
  const recentKey = `${login}\n${userAgent}\n${name ?? ""}`;
  const recent = fresh.get(recentKey);
  if (recent && Date.now() - recent.at < 5 * 60_000 && read().devices.some((device) => device.id === recent.device.id)) return recent;

  const issued = { ...addDevice(name?.trim() || deviceName(userAgent), login), at: Date.now() };
  fresh.set(recentKey, issued);
  return issued;
}

const CODE_LIFETIME = 10 * 60_000;
const CODE_TRIES = 5;

/**
 * A one-time code that pairs a device without Tailscale: a paired device
 * shows it (Settings › General › Devices) and the new one types it on the
 * "not paired" page. One is on offer at a time, spent by a pairing, ten
 * minutes or five wrong tries — five chances in a hundred million for anyone
 * guessing. Only its hash is kept, in memory.
 */
export function createPairingCode(): { code: string; expiresAt: number } {
  const code = String(randomInt(100_000_000)).padStart(8, "0");
  const expiresAt = Date.now() + CODE_LIFETIME;
  memory.__slatesPairing = { hash: hashOf(code), expiresAt, misses: 0 };
  return { code, expiresAt };
}

/** Pair the device that typed a code, or say why not. */
export function redeemPairingCode(typed: string, userAgent: string): { key: string; device: Device } | { error: "wrong" | "expired" } {
  const offer = memory.__slatesPairing;
  if (!offer || Date.now() > offer.expiresAt) {
    memory.__slatesPairing = undefined;
    return { error: "expired" };
  }
  const digits = typed.replace(/\D/g, "");
  // Too short or long to be the code: a typo, which costs no try.
  if (digits.length !== 8) return { error: "wrong" };
  if (!timingSafeEqual(Buffer.from(hashOf(digits), "hex"), Buffer.from(offer.hash, "hex"))) {
    if (++offer.misses >= CODE_TRIES) memory.__slatesPairing = undefined;
    return { error: "wrong" };
  }
  memory.__slatesPairing = undefined;
  return addDevice(deviceName(userAgent));
}

/** Record that a device was used, at most hourly so every request isn't a disk write. */
export function touch(device: Device): void {
  if (Date.now() - device.lastSeen < 60 * 60_000) return;
  const registry = read();
  write({ ...registry, devices: registry.devices.map((entry) => (entry.id === device.id ? { ...entry, lastSeen: Date.now() } : entry)) });
}

export function listDevices(): Omit<Device, "hash">[] {
  return read().devices.map((device) => ({ id: device.id, name: device.name, createdAt: device.createdAt, lastSeen: device.lastSeen }));
}

export function forgetDevice(id: string): boolean {
  const registry = read();
  if (!registry.devices.some((device) => device.id === id)) return false;
  write({ ...registry, devices: registry.devices.filter((device) => device.id !== id) });
  return true;
}

export function deviceName(userAgent: string): string {
  // The phone app's web view adds "SlatesApp" (mobile/capacitor.config.ts); Android's says "; wv)" anyway.
  const app = /Electron|SlatesApp|; wv\)/i.test(userAgent) ? "Slates app" : "Browser";
  const place = /iPhone/i.test(userAgent) ? "iPhone"
    : /iPad/i.test(userAgent) ? "iPad"
      : /Android/i.test(userAgent) ? "Android"
        : /Macintosh|Mac OS X/i.test(userAgent) ? "Mac"
          : /Windows/i.test(userAgent) ? "Windows"
            : /Linux/i.test(userAgent) ? "Linux" : "device";
  return `${app} on ${place}`;
}
