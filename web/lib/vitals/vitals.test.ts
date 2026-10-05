import assert from "node:assert/strict";
import test from "node:test";

import { bundleOf, groupApps, ownerOf, projectsFrom, protectedFrom, quitPlan, runtimeLabel, serverState, stopPlan, type ProcInfo, type ProcLive } from "./group";
import {
  clockSeconds,
  ioNumber,
  parseBattery,
  parseDefaultRoute,
  parseDiskStats,
  parseGpu,
  parseGpuClients,
  parseHardwarePorts,
  parseListeners,
  parseNetstat,
  parseNettop,
  parseProbe,
  parsePs,
  parseSwap,
  parseSysctl,
  parseVmStat,
} from "./parse";

// What macOS's tools print, trimmed from a real M4 Pro, and the rules that
// turn it into apps, projects and what may be stopped.

/* ── the tools' output ─────────────────────────────────────────────────── */

test("ps times read with days, hours and fractions", () => {
  assert.equal(clockSeconds("0:00.21"), 0.21);
  assert.equal(clockSeconds("62:45.31"), 3765.31);
  assert.equal(clockSeconds("02-23:55:17"), 2 * 86_400 + 23 * 3600 + 55 * 60 + 17);
  assert.equal(clockSeconds("1:02:03"), 3723);
  assert.equal(clockSeconds("garbage"), 0);
});

test("ps rows keep paths with spaces and names a process gave itself", () => {
  const rows = parsePs(
    [
      "    0     0     0     0 1234:56.78  28672 07-10:07:00 kernel_task",
      "64720     1 64720   501  40:12.00 412000 05-01:00:00 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "91870 91860 91860   501   9:31.03 5754874 02-23:55:17 next-server (v16.3.5) ",
      "not a row",
    ].join("\n"),
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], { pid: 64720, ppid: 1, pgid: 64720, uid: 501, cpuTime: 2412, rss: 412000 * 1024, uptime: 5 * 86_400 + 3600, path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  assert.equal(rows[2]!.path, "next-server (v16.3.5)");
  assert.equal(rows[0]!.path, "kernel_task");
});

test("the probe's tagged lines", () => {
  const probe = parseProbe(
    [
      "X\t1\t/sbin/launchd",
      "X\t91870\t/Users/s/.nvm/versions/node/v22.14.0/bin/node",
      "P\t91870\t91870\t5557614464\t1135512801726\t18635386880\t5675786240\t/Users/s/projects/cramzo",
      "P\t5401\t64720\t27000000\t42023844\t163840\t0\t",
      "G\t59\t58\t34\t1412153344\t16\tApple M4 Pro",
      "C\t412\t17810556895416",
      "C\t412\t116139000",
      "C\t761\t14954627833",
      "D\t6076887723008\t1849637687296",
      "",
    ].join("\n"),
  );
  assert.equal(probe.paths.get(1), "/sbin/launchd");
  assert.deepEqual(probe.procs.get(91870), { pid: 91870, responsible: 91870, footprint: 5557614464, energy: 1135512801726, read: 18635386880, write: 5675786240, cwd: "/Users/s/projects/cramzo" });
  assert.equal(probe.procs.get(5401)!.responsible, 64720);
  assert.equal(probe.procs.get(5401)!.cwd, "");
  assert.deepEqual(probe.gpu, { name: "Apple M4 Pro", cores: 16, busy: 59, renderer: 58, tiler: 34, mem: 1412153344 });
  assert.equal(probe.gpuTime.get(412), 17810556895416 + 116139000);
  assert.deepEqual(probe.disk, { read: 6076887723008, written: 1849637687296 });
});

test("nettop rows are split at the last dot, so names with dots keep them", () => {
  const rows = parseNettop([",bytes_in,bytes_out,", "launchd.1,0,0,", "com.docker.backend.8812,1200,300,", "Google Chrome H.4025,5000,70,", "bad,1,2,"].join("\n"));
  assert.deepEqual(rows.get(8812), { down: 1200, up: 300 });
  assert.deepEqual(rows.get(4025), { down: 5000, up: 70 });
  assert.equal(rows.size, 3);
});

test("vm_stat pages, sysctl names and the swap line", () => {
  const vm = parseVmStat(
    [
      "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
      "Pages free:                                6107.",
      "Pages speculative:                          738.",
      "Pages wired down:                        327728.",
      "Pages purgeable:                          12686.",
      "File-backed pages:                       166230.",
      "Anonymous pages:                         596980.",
      "Pages occupied by compressor:            433409.",
    ].join("\n"),
  );
  assert.deepEqual(vm, { pageSize: 16384, free: 6107, speculative: 738, wired: 327728, anonymous: 596980, fileBacked: 166230, purgeable: 12686, compressor: 433409 });
  const sys = parseSysctl("vm.swapusage: total = 12800.00M  used = 11947.44M  free = 852.56M  (encrypted)\nkern.memorystatus_vm_pressure_level: 1\n");
  assert.equal(sys.get("kern.memorystatus_vm_pressure_level"), "1");
  const swap = parseSwap(sys.get("vm.swapusage"));
  assert.equal(swap.total, 12800 * 1024 ** 2);
  assert.equal(swap.used, Math.round(11947.44 * 1024 ** 2));
  assert.deepEqual(parseSwap(undefined), { used: 0, total: 0 });
});

test("ioreg's negative numbers, printed unsigned, come back negative", () => {
  assert.equal(ioNumber("18446744073709550116"), -1500);
  assert.equal(ioNumber("13026"), 13026);
  assert.ok(Number.isNaN(ioNumber("Yes")));
});

const BATTERY = (lines: string[]) => ["+-o AppleSmartBattery  <class AppleSmartBattery>", "    {", ...lines.map((l) => `      ${l}`), "    }"].join("\n");

test("the battery on the adapter, full", () => {
  const battery = parseBattery(
    BATTERY([
      '"BatteryInstalled" = Yes',
      '"CurrentCapacity" = 100',
      '"ExternalConnected" = Yes',
      '"IsCharging" = No',
      '"FullyCharged" = Yes',
      '"AvgTimeToEmpty" = 65535',
      '"TimeRemaining" = 65535',
      '"CycleCount" = 594',
      '"DesignCapacity" = 6249',
      '"NominalChargeCapacity" = 5510',
      '"AppleRawMaxCapacity" = 5358',
      '"Temperature" = 3095',
      '"Voltage" = 13026',
      '"InstantAmperage" = 0',
      '"AdapterDetails" = {"Watts"=94,"Description"="pd charger","Name"="140W USB-C Power Adapter","AdapterVoltage"=20000}',
      '"BatteryData" = {"Voltage"=1,"CycleCount"=2}',
    ]),
  );
  assert.deepEqual(battery, {
    percent: 100,
    charging: false,
    plugged: true,
    full: true,
    minutes: null,
    cycles: 594,
    health: 88,
    temperature: 31,
    draw: null,
    adapter: { name: "140W USB-C Power Adapter", watts: 94 },
  });
});

test("the battery on its own: time left and what it's drawing", () => {
  const battery = parseBattery(
    BATTERY([
      '"CurrentCapacity" = 64',
      '"ExternalConnected" = No',
      '"IsCharging" = No',
      '"AvgTimeToEmpty" = 166',
      '"CycleCount" = 412',
      '"DesignCapacity" = 6249',
      '"AppleRawMaxCapacity" = 4749',
      '"Temperature" = 3120',
      '"Voltage" = 12000',
      '"InstantAmperage" = 18446744073709550566',
    ]),
  );
  assert.equal(battery!.minutes, 166);
  assert.equal(battery!.health, 76);
  assert.equal(battery!.adapter, null);
  assert.ok(Math.abs(battery!.draw! - 12.6) < 0.001, `draw ${battery!.draw}`);
  assert.equal(parseBattery("+-o Root\n"), null);
});

const GPU = [
  "+-o AGXAcceleratorG16X  <class AGXAcceleratorG16X>",
  '    | {',
  '    |   "model" = "Apple M4 Pro"',
  '    |   "gpu-core-count" = 16',
  '    |   "PerformanceStatistics" = {"In use system memory"=1717813248,"Tiler Utilization %"=31,"Renderer Utilization %"=59,"Device Utilization %"=65}',
  "    | }",
  "    +-o AGXDeviceUserClient  <class AGXDeviceUserClient>",
  '        {',
  '          "AppUsage" = ({"API"="Metal","accumulatedGPUTime"=1000},{"API"="Metal","accumulatedGPUTime"=500})',
  '          "IOUserClientCreator" = "pid 412, WindowServer"',
  "        }",
  "    +-o AGXDeviceUserClient  <class AGXDeviceUserClient>",
  '        {',
  '          "AppUsage" = ()',
  '          "IOUserClientCreator" = "pid 415, runningboardd"',
  "        }",
  "    +-o AGXDeviceUserClient  <class AGXDeviceUserClient>",
  '        {',
  '          "AppUsage" = ({"API"="Metal","accumulatedGPUTime"=250})',
  '          "IOUserClientCreator" = "pid 412, WindowServer"',
  "        }",
].join("\n");

test("the GPU and the GPU time each process has used", () => {
  assert.deepEqual(parseGpu(GPU), { name: "Apple M4 Pro", cores: 16, busy: 65, renderer: 59, tiler: 31, mem: 1717813248 });
  assert.deepEqual([...parseGpuClients(GPU)], [[412, 1750]]);
  assert.equal(parseGpu("nothing"), null);
});

test("disk bytes add up over every disk, and netstat counts the Mac's own ports once each", () => {
  const disks = parseDiskStats(
    '"Statistics" = {"Operations (Write)"=0,"Bytes (Read)"=0,"Bytes (Write)"=0}\n"Statistics" = {"Bytes (Read)"=6012095574016,"Errors (Write)"=0,"Bytes (Write)"=1842482016256}',
  );
  assert.deepEqual(disks, { read: 6012095574016, written: 1842482016256 });

  const wire = parseNetstat(
    [
      "Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll",
      "lo0        16384 <Link#1>                      11794787     0 9445777462 11794787     0 9445777462     0",
      "en0        1500  <Link#11>   a4:fc:14:1:2:3    90000000     0 95000000000 60000000     0 48000000000     0",
      "en0        1500  fe80::1%en0 fe80:b::1         90000000     - 95000000000 60000000     - 48000000000     -",
      "en4*       1500  <Link#14>                            10     0       2000       20     0       3000     0",
      "utun3      1380  <Link#25>                       500000     0 900000000   400000     0 800000000     0",
    ].join("\n"),
  );
  assert.deepEqual(wire, { in: 95000002000, out: 48000003000 });
});

test("listening ports per process, and the default interface's name", () => {
  const ports = parseListeners(["p91870", "f16", "n*:3000", "p698", "f11", "n*:49153", "f14", "n*:49153", "f23", "n[::1]:53510", "p955", "n127.0.0.1:8787"].join("\n"));
  assert.deepEqual([...ports], [
    [91870, [3000]],
    [698, [49153, 53510]],
    [955, [8787]],
  ]);
  assert.equal(parseDefaultRoute("   route to: default\n  interface: en0\n"), "en0");
  assert.equal(parseDefaultRoute(""), null);
  assert.deepEqual([...parseHardwarePorts("Hardware Port: Wi-Fi\nDevice: en0\nEthernet Address: x\n\nHardware Port: Thunderbolt Bridge\nDevice: bridge0\n")], [
    ["en0", "Wi-Fi"],
    ["bridge0", "Thunderbolt Bridge"],
  ]);
});

/* ── apps ──────────────────────────────────────────────────────────────── */

const ME = 501;
const CHROME = "/Applications/Google Chrome.app";
const CMUX = "/Applications/cmux.app";

function proc(pid: number, path: string, more: Partial<ProcLive> = {}): ProcLive {
  return {
    pid,
    ppid: 1,
    pgid: pid,
    uid: ME,
    path,
    uptime: 7200,
    cpuTime: 100,
    mem: 100 * 1024 ** 2,
    responsible: pid,
    cwd: null,
    cpu: 0,
    power: 0,
    read: 0,
    write: 0,
    down: 0,
    up: 0,
    gpu: 0,
    ...more,
  };
}

const MAC: ProcLive[] = [
  proc(0, "kernel_task", { uid: 0, ppid: 0, responsible: 0, power: null, read: null, write: null, cpu: 40 }),
  proc(1, "/sbin/launchd", { uid: 0, ppid: 0, responsible: 0, power: null, read: null, write: null }),
  proc(412, "/System/Library/PrivateFrameworks/SkyLight.framework/Versions/A/Resources/WindowServer", { uid: 88, responsible: 0, power: null, read: null, write: null, cpu: 30 }),
  proc(640, "/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder", { cpu: 1 }),
  proc(64720, `${CHROME}/Contents/MacOS/Google Chrome`, { cpu: 10, power: 1.5, mem: 400 * 1024 ** 2 }),
  proc(5401, `${CHROME}/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)`, {
    ppid: 64720,
    pgid: 64720,
    responsible: 64720,
    cpu: 20,
    power: 2,
    mem: 300 * 1024 ** 2,
  }),
  proc(25444, `${CMUX}/Contents/MacOS/cmux`, { cpu: 2 }),
  proc(25500, "/bin/zsh", { ppid: 25444, pgid: 25500, responsible: 25444, cwd: "/Users/s/projects/slates" }),
  // `npm run dev` typed into that terminal: its own job.
  proc(25600, "/usr/local/bin/node", { ppid: 25500, pgid: 25600, responsible: 25444, cwd: "/Users/s/projects/slates/web" }),
  proc(25601, "/bin/sh", { ppid: 25600, pgid: 25600, responsible: 25444, cwd: "/Users/s/projects/slates/web" }),
  proc(25602, "/usr/local/bin/node", { ppid: 25601, pgid: 25600, responsible: 25444, cwd: "/Users/s/projects/slates/web", cpu: 0.2, mem: 900 * 1024 ** 2, uptime: 3 * 86_400, cpuTime: 60 }),
  // A server left running after its terminal closed, now launchd's.
  proc(35523, "/Users/s/.nvm/bin/node", { pgid: 35000, cwd: "/Users/s/projects/spanish", mem: 20 * 1024 ** 2, uptime: 5 * 86_400, cpuTime: 2 }),
  proc(955, "/Users/s/.nvm/bin/node", { cwd: "/Users/s", mem: 50 * 1024 ** 2 }),
  proc(46087, "/Applications/Raycast.app/Contents/MacOS/Raycast", {}),
];

const byPid = new Map<number, ProcInfo>(MAC.map((p) => [p.pid, p]));

test("each process is filed under the app responsible for it", () => {
  assert.equal(bundleOf(MAC[5]!.path), CHROME);
  assert.equal(ownerOf(MAC[5]!, byPid).name, "Google Chrome");
  assert.equal(ownerOf(MAC[10]!, byPid).key, CMUX);
  assert.equal(ownerOf(MAC[2]!, byPid).key, "macos");
  assert.equal(ownerOf(MAC[3]!, byPid).key, "macos");
  assert.equal(ownerOf(MAC[0]!, byPid).key, "macos");
  assert.deepEqual(ownerOf(MAC[11]!, byPid), { key: "tool:node", name: "node", kind: "tool", bundle: null });
  // macOS's own apps are apps; its background bundles aren't.
  const safari = proc(900, "/System/Cryptexes/App/System/Applications/Safari.app/Contents/MacOS/Safari");
  assert.equal(ownerOf(safari, byPid).name, "Safari");
});

test("without the probe, a process climbs its parents to the app that started it", () => {
  const blind = MAC.map((p) => ({ ...p, responsible: 0 }));
  const map = new Map<number, ProcInfo>(blind.map((p) => [p.pid, p]));
  assert.equal(ownerOf(blind[10]!, map).key, CMUX);
  assert.equal(ownerOf(blind[5]!, map).key, CHROME);
  // A user process that renamed itself isn't macOS's.
  const retitled = { ...proc(91870, "next-server (v16.3.5)"), responsible: 0 };
  assert.equal(ownerOf(retitled, map).kind, "tool");
});

test("apps add up their processes, and only apps that can be quit say so", () => {
  const guard = protectedFrom(MAC, 25602);
  const apps = groupApps(MAC, { uid: ME, protectedBundles: guard.bundles });
  const chrome = apps.find((a) => a.key === CHROME)!;
  assert.equal(chrome.procs.length, 2);
  assert.equal(chrome.cpu, 30);
  assert.equal(chrome.power, 3.5);
  assert.equal(chrome.mem, 700 * 1024 ** 2);
  assert.equal(chrome.procs[0]!.pid, 5401, "busiest process first");
  assert.equal(chrome.quittable, true);
  assert.equal(apps[0]!.key, "macos", "sorted by CPU");

  // Slates runs in the terminal here, so the terminal can't be quit from Slates.
  assert.equal(apps.find((a) => a.key === CMUX)!.quittable, false);
  assert.equal(apps.find((a) => a.key === "macos")!.quittable, false);
  // Most of macOS's CPU is root's, which the probe can't read for power.
  assert.equal(apps.find((a) => a.key === "macos")!.power, null);
});

/* ── projects ──────────────────────────────────────────────────────────── */

const ROOTS: Record<string, { root: string; name: string; sub: string | null }> = {
  "/Users/s/projects/slates": { root: "/Users/s/projects/slates", name: "slates", sub: null },
  "/Users/s/projects/slates/web": { root: "/Users/s/projects/slates", name: "slates", sub: "web" },
  "/Users/s/projects/spanish": { root: "/Users/s/projects/spanish", name: "spanish", sub: null },
};
const rootOf = (cwd: string) => ROOTS[cwd] ?? null;

test("a server's state: working now, idle, or barely used since it started", () => {
  assert.equal(serverState(4, 60, 1), "working");
  assert.equal(serverState(0, 600, 0.1), "idle");
  assert.equal(serverState(0, 3 * 86_400, 60), "quiet");
  assert.equal(serverState(0, 3 * 86_400, 9000), "idle");
});

test("a server's label is its title, or its program and script, never its arguments", () => {
  assert.equal(runtimeLabel("/usr/local/bin/node", "next-server (v16.3.5) "), "next-server (v16.3.5)");
  assert.equal(runtimeLabel("/usr/local/bin/node", "/usr/local/bin/node --env-file=.env /Users/s/app/server.js --token=abc"), "node server.js");
  assert.equal(runtimeLabel("/opt/homebrew/bin/python3", "python3 -m http.server 8000"), "python3 http.server");
  assert.equal(runtimeLabel("/usr/local/bin/node", undefined), "node");
  // A title that ran on into the environment: what ps really printed for one.
  assert.equal(runtimeLabel("/usr/local/bin/node", "next-server (v PATH=/Users/s/.nvm/bin:/usr/bin OPENAI_API_KEY=sk-secret"), "next-server");
  assert.equal(runtimeLabel("/usr/local/bin/node", "/usr/local/bin/node API_TOKEN=abc server.js"), "node server.js");
});

test("servers are grouped by project; other listeners are listed as ports", () => {
  const listening = new Map([
    [25602, [7528]],
    [35523, [5173]],
    [955, [8787]],
    [46087, [7265]],
  ]);
  const commands = new Map([
    [25602, "next-server (v16.3.5)"],
    [35523, "/Users/s/.nvm/bin/node server.js"],
  ]);
  const guard = protectedFrom(MAC, 25602);
  const { projects, ports } = projectsFrom(MAC, listening, { uid: ME, protectedPids: guard.pids, rootOf, commands });

  assert.deepEqual(
    projects.map((p) => [p.name, p.servers.map((s) => [s.name, s.runtime, s.ports, s.state, s.locked])]),
    [
      ["slates", [["web", "next-server (v16.3.5)", [7528], "quiet", "Slates is running from it"]]],
      ["spanish", [["spanish", "node server.js", [5173], "quiet", null]]],
    ],
  );
  // npm, its sh wrapper and the server; not the zsh it was typed into.
  assert.equal(projects[0]!.procs, 3);
  assert.deepEqual(ports, [
    { port: 7265, pid: 46087, name: "Raycast" },
    { port: 8787, pid: 955, name: "node" },
  ]);
});

/* ── what may be stopped or quit ───────────────────────────────────────── */

test("a dev server stops with its whole job, as Ctrl-C would", () => {
  const plan = stopPlan(35523, MAC, { uid: ME, protectedPids: new Set([999]), listening: new Set([35523]) });
  assert.deepEqual(plan, { kind: "pids", pids: [35523] }, "its job's leader is gone, so only it");

  const job = stopPlan(25602, MAC, { uid: ME, protectedPids: new Set(), listening: new Set([25602]) });
  assert.deepEqual(job, { kind: "group", pgid: 25600, pids: [25600, 25601, 25602] }, "npm leads it; its sh -c is part of it");
});

test("a server run straight from a shell, with no job of its own, is stopped alone", () => {
  // An agent's bash without job control: the server shares the shell's group.
  const agent = [proc(700, "/bin/bash", { pgid: 700 }), proc(701, "/usr/local/bin/node", { ppid: 700, pgid: 700, cwd: "/Users/s/projects/spanish" }), proc(702, "/usr/local/bin/node", { ppid: 701, pgid: 700 })];
  assert.deepEqual(stopPlan(701, agent, { uid: ME, protectedPids: new Set(), listening: new Set([701]) }), { kind: "pids", pids: [701, 702] });
});

test("nothing Slates runs from, another user's, an app's, or no longer serving is stopped", () => {
  const guard = protectedFrom(MAC, 25602);
  const opts = { uid: ME, protectedPids: guard.pids, listening: new Set([25602, 46087, 412]) };
  assert.equal(stopPlan(25602, MAC, opts).kind, "refuse");
  assert.equal((stopPlan(412, MAC, opts) as { reason: string }).reason, "It belongs to another user on this Mac.");
  assert.equal((stopPlan(46087, MAC, opts) as { reason: string }).reason, "It's part of an app. Quit the app instead.");
  assert.equal((stopPlan(35523, MAC, opts) as { reason: string }).reason, "It isn't serving on a port any more.");
  assert.equal((stopPlan(4242, MAC, opts) as { reason: string }).reason, "It has already stopped.");
  assert.ok(guard.pids.has(25600) && guard.pids.has(25500) && guard.pids.has(25444), "everything above Slates");
  assert.ok(guard.bundles.has(CMUX));
});

test("quitting asks the app's own process, and never macOS or what Slates runs in", () => {
  const guard = protectedFrom(MAC, 25602);
  const opts = { uid: ME, protectedBundles: guard.bundles };
  assert.deepEqual(quitPlan(CHROME, MAC, opts), { kind: "quit", name: "Google Chrome", pids: [64720] });
  assert.equal(quitPlan(CMUX, MAC, opts).kind, "refuse");
  assert.equal(quitPlan("/System/Library/CoreServices/Finder.app", MAC, opts).kind, "refuse");
  assert.equal(quitPlan("macos", MAC, opts).kind, "refuse");
  assert.equal((quitPlan("/Applications/Xcode.app", MAC, opts) as { reason: string }).reason, "Xcode isn't running.");
});
