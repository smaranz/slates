import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { isPublicPath, originOf, unpairedPage } from "./device-gate";
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

test("only the host check and the pairing form are open to anyone", () => {
  assert.equal(isPublicPath("GET", "/api/host"), true);
  assert.equal(isPublicPath("POST", "/api/host"), false);
  assert.equal(isPublicPath("POST", "/api/devices/pair"), true);
  assert.equal(isPublicPath("GET", "/api/devices/pair"), false);
  assert.equal(isPublicPath("POST", "/api/devices/code"), false);
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

const IPHONE_APP = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 SlatesApp";
const otherThan = (code: string) => (code === "00000000" ? "11111111" : "00000000");

test("a code pairs one device, once", () => {
  const { code, expiresAt } = devices.createPairingCode();
  assert.match(code, /^\d{8}$/);
  assert.ok(expiresAt > Date.now());

  assert.deepEqual(devices.redeemPairingCode(otherThan(code), IPHONE_APP), { error: "wrong" });
  const paired = devices.redeemPairingCode(`${code.slice(0, 4)} ${code.slice(4)}`, IPHONE_APP);
  assert.ok("key" in paired);
  assert.equal(paired.device.name, "Slates app on iPhone");
  assert.equal(devices.verifyKey(paired.key)?.id, paired.device.id);
  assert.equal(devices.isOwner("someone-else@gmail.com"), false, "pairing by code doesn't change whose Slates it is");

  assert.deepEqual(devices.redeemPairingCode(code, IPHONE_APP), { error: "expired" }, "a used code is spent");
});

test("typos cost nothing, but five wrong tries spend a code, and so do ten minutes", (t) => {
  let { code } = devices.createPairingCode();
  for (let i = 0; i < 10; i++) devices.redeemPairingCode("1234", IPHONE_APP);
  for (let i = 0; i < 4; i++) devices.redeemPairingCode(otherThan(code), IPHONE_APP);
  assert.ok("key" in devices.redeemPairingCode(code, IPHONE_APP), "four misses and any number of typos leave it working");

  ({ code } = devices.createPairingCode());
  for (let i = 0; i < 5; i++) assert.deepEqual(devices.redeemPairingCode(otherThan(code), IPHONE_APP), { error: "wrong" });
  assert.deepEqual(devices.redeemPairingCode(code, IPHONE_APP), { error: "expired" }, "the fifth miss spends it");

  ({ code } = devices.createPairingCode());
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 10 * 60_000 + 1);
  assert.deepEqual(devices.redeemPairingCode(code, IPHONE_APP), { error: "expired" });
});

test("a new code replaces the last one", () => {
  const first = devices.createPairingCode().code;
  const second = devices.createPairingCode().code;
  if (first !== second) assert.deepEqual(devices.redeemPairingCode(first, IPHONE_APP), { error: "wrong" });
  assert.ok("key" in devices.redeemPairingCode(second, IPHONE_APP));
});

test("names the phone app apart from a browser", () => {
  assert.equal(devices.deviceName(IPHONE_APP), "Slates app on iPhone");
  assert.equal(devices.deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"), "Browser on iPhone");
  assert.equal(devices.deviceName("Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP4A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0 Mobile Safari/537.36"), "Slates app on Android");
});

test("the not-paired page takes a code and says why one failed, without echoing the address", () => {
  assert.match(unpairedPage(), /<form method="post" action="\/api\/devices\/pair">/);
  assert.doesNotMatch(unpairedPage(), /role="alert"/);
  assert.match(unpairedPage("wrong"), /role="alert"[^>]*>That code isn’t right/);
  assert.match(unpairedPage("expired"), /role="alert"[^>]*>That code has run out/);
  assert.doesNotMatch(unpairedPage("<img src=x onerror=alert(1)>"), /onerror|role="alert"/);
});
