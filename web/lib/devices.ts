import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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
 * and keeps it as a cookie. Keys are 256-bit random; only their SHA-256 is
 * stored, under ~/.slates/devices.json on the host.
 */

export const DEVICE_COOKIE = "slates_device";
/** Browsers cap cookie lifetimes near 400 days; each visit renews it. */
export const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

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

/**
 * A key for something that isn't a browser — the Mac's coding agents, a
 * script. Only callers already on the host or the tailnet may ask (the route
 * checks), so a leaked device key can't mint itself more.
 */
export function mintKey(name: string): { key: string; device: Device } {
  const registry = read();
  const secret = randomBytes(32).toString("base64url");
  const now = Date.now();
  const device: Device = { id: randomBytes(8).toString("hex"), name: name.trim().slice(0, 60) || "Script", hash: hashOf(secret), createdAt: now, lastSeen: now };
  write({ ...registry, devices: [...registry.devices, device].slice(-50) });
  return { key: `${device.id}.${secret}`, device };
}

/** Pair a device for a Tailscale-verified login. Null when that login isn't the owner. */
export function enroll(login: string, userAgent: string, name?: string): { key: string; device: Device } | null {
  const registry = read();
  if (registry.owner && registry.owner !== login) return null;

  const fresh = (memory.__slatesFreshKeys ??= new Map());
  const recentKey = `${login}\n${userAgent}\n${name ?? ""}`;
  const recent = fresh.get(recentKey);
  if (recent && Date.now() - recent.at < 5 * 60_000 && registry.devices.some((device) => device.id === recent.device.id)) return recent;

  const secret = randomBytes(32).toString("base64url");
  const now = Date.now();
  const device: Device = { id: randomBytes(8).toString("hex"), name: name?.trim().slice(0, 60) || deviceName(userAgent), hash: hashOf(secret), createdAt: now, lastSeen: now };
  write({ owner: registry.owner ?? login, devices: [...registry.devices, device].slice(-50) });
  const issued = { key: `${device.id}.${secret}`, device, at: now };
  fresh.set(recentKey, issued);
  return issued;
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
  const app = /Electron/i.test(userAgent) ? "Slates app" : /Capacitor|; wv\)/i.test(userAgent) ? "Slates app" : "Browser";
  const place = /iPhone/i.test(userAgent) ? "iPhone"
    : /iPad/i.test(userAgent) ? "iPad"
      : /Android/i.test(userAgent) ? "Android"
        : /Macintosh|Mac OS X/i.test(userAgent) ? "Mac"
          : /Windows/i.test(userAgent) ? "Windows"
            : /Linux/i.test(userAgent) ? "Linux" : "device";
  return `${app} on ${place}`;
}
