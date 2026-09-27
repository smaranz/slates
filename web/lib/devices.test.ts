import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { isPublicPath, originOf } from "./device-gate";
import * as devices from "./devices";

// The registry lives under HOME, read when first used; point it somewhere disposable.
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "slates-devices-"));

// Header sets as Tailscale really forwards them, captured from the host with
// forged headers sent in: identity headers are only ever Tailscale's own,
// Funnel traffic is marked, and a forged Host still gets through.
const tailnet = new Headers({ host: "smaran.tail55de6b.ts.net", "x-forwarded-proto": "https", "x-forwarded-for": "100.116.19.73", "tailscale-user-login": "profcraft45@gmail.com" });
const funnel = new Headers({ host: "smaran.tail55de6b.ts.net", "x-forwarded-proto": "https", "x-forwarded-for": "73.231.67.216", "tailscale-funnel-request": "?1" });
const funnelForgedHost = new Headers({ host: "localhost:7528", "x-forwarded-proto": "https", "x-forwarded-for": "73.231.67.216", "tailscale-funnel-request": "?1" });
const onHost = new Headers({ host: "localhost:7528", "x-forwarded-proto": "http" });

test("tells the host, the tailnet and the internet apart, whatever Host says", () => {
  assert.deepEqual(originOf(tailnet), { kind: "tailnet", login: "profcraft45@gmail.com" });
  assert.deepEqual(originOf(funnel), { kind: "outside" });
  assert.deepEqual(originOf(funnelForgedHost), { kind: "outside" });
  assert.deepEqual(originOf(onHost), { kind: "local" });
  assert.deepEqual(originOf(new Headers({ host: "127.0.0.1:7528" })), { kind: "local" });
  // Funnel with an identity header can't happen (Tailscale strips it), but if it ever did it wouldn't count.
  assert.deepEqual(originOf(new Headers({ "x-forwarded-proto": "https", "tailscale-funnel-request": "?1", "tailscale-user-login": "someone@x.com" })), { kind: "outside" });
});

test("only the host check is open to anyone", () => {
  assert.equal(isPublicPath("GET", "/api/host"), true);
  assert.equal(isPublicPath("POST", "/api/host"), false);
  assert.equal(isPublicPath("GET", "/api/study"), false);
  assert.equal(isPublicPath("GET", "/"), false);
});

test("pairs the owner's devices, rejects other accounts, and checks keys", () => {
  const first = devices.enroll("profcraft45@gmail.com", "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) Electron/38.0");
  assert.ok(first);
  assert.equal(first.device.name, "Slates app on Mac");
  assert.equal(devices.verifyKey(first.key)?.id, first.device.id);

  // The same browser asking again moments later gets the same key, not a second device.
  assert.equal(devices.enroll("profcraft45@gmail.com", "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) Electron/38.0")?.key, first.key);

  assert.equal(devices.isOwner("someone-else@gmail.com"), false);
  assert.equal(devices.enroll("someone-else@gmail.com", "Mozilla/5.0 (iPhone)"), null);

  const phone = devices.enroll("profcraft45@gmail.com", "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)");
  assert.equal(phone?.device.name, "Browser on iPhone");

  const [id, secret] = first.key.split(".");
  assert.equal(devices.verifyKey(`${id}.${secret!.slice(0, -1)}A`), null, "a wrong secret fails");
  assert.equal(devices.verifyKey("not-a-key"), null);
  assert.equal(devices.verifyKey(null), null);

  const stored = fs.readFileSync(path.join(process.env.HOME!, ".slates", "devices.json"), "utf8");
  assert.ok(!stored.includes(secret!), "only the hash is stored");
});

test("forgets a device, which stops its key working", () => {
  const minted = devices.mintKey("Mac (coding agents)");
  assert.equal(devices.verifyKey(minted.key)?.name, "Mac (coding agents)");
  assert.ok(devices.listDevices().every((device) => !("hash" in device)));
  assert.equal(devices.forgetDevice(minted.device.id), true);
  assert.equal(devices.verifyKey(minted.key), null);
  assert.equal(devices.forgetDevice(minted.device.id), false);
});
