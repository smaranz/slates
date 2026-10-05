import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { groupApps, projectsFrom, protectedFrom, type ProcInfo, type ProcLive, type RootInfo } from "./group";
import {
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
  PS_ARGS,
  PS_SHORT_ARGS,
  type BatteryReading,
  type GpuReading,
  type Probe,
  type ProbeRow,
  type VmStat,
} from "./parse";
import { probeBinary, probeMissing, readProbe } from "./probe";
import type { VitalsCpu, VitalsHost, VitalsMemory, VitalsNetwork, VitalsSnapshot } from "./types";

/**
 * Reads this Mac, the way Activity Monitor does but from the command line:
 * `ps` for every process, the probe for what only the kernel knows, `nettop`
 * for each process's traffic, ioreg for the GPU, the disks and the battery.
 *
 * Nothing is kept between visits. Rates are the difference between two
 * readings, so the first request takes two a moment apart, and later ones
 * use the reading before. Ports, the battery and the disk's free space move
 * slowly and are read every ten seconds.
 */

function sh(file: string, args: string[], timeout = 8_000): Promise<string> {
  return new Promise((resolve) => {
    // Several of these exit non-zero with good output (lsof with nothing to list, sysctl with an unknown name).
    execFile(file, args, { timeout, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" }, (_err, stdout) => resolve(stdout ?? ""));
  });
}

interface Reading {
  at: number;
  procs: ProcInfo[];
  probe: Map<number, ProbeRow> | null;
  net: Map<number, { down: number; up: number }>;
  gpuTime: Map<number, number>;
  cpus: os.CpuInfo[];
  disk: { read: number; written: number };
  wire: { in: number; out: number };
  vm: VmStat;
  sysctl: Map<string, string>;
  gpu: GpuReading | null;
}

function merge(psOut: string, probe: Probe | null): ProcInfo[] {
  return parsePs(psOut).map((row) => {
    const extra = probe?.procs.get(row.pid);
    return {
      pid: row.pid,
      ppid: row.ppid,
      pgid: row.pgid,
      uid: row.uid,
      path: probe?.paths.get(row.pid) ?? row.path,
      uptime: row.uptime,
      cpuTime: row.cpuTime,
      mem: extra ? extra.footprint : row.rss,
      responsible: extra?.responsible ?? 0,
      cwd: extra?.cwd || null,
    };
  });
}

/** `ps` and the probe side by side: with the probe, `ps` needn't look up every path. */
async function table(): Promise<{ psOut: string; probe: Probe | null }> {
  const short = !!(await probeBinary());
  const [psOut, probeOut] = await Promise.all([sh("/bin/ps", short ? PS_SHORT_ARGS : PS_ARGS), readProbe()]);
  return { psOut, probe: probeOut ? parseProbe(probeOut) : null };
}

async function read(): Promise<Reading> {
  const [{ psOut, probe }, netOut, vmOut, sysOut, wireOut] = await Promise.all([
    table(),
    sh("/usr/bin/nettop", ["-P", "-L", "1", "-x", "-J", "bytes_in,bytes_out"]),
    sh("/usr/bin/vm_stat", []),
    sh("/usr/sbin/sysctl", ["vm.swapusage", "kern.memorystatus_vm_pressure_level"]),
    sh("/usr/sbin/netstat", ["-ibn"]),
  ]);
  // Without the probe, ioreg says the same about the GPU and the disks, at some cost.
  const [gpuOut, diskOut] = probe
    ? ["", ""]
    : await Promise.all([sh("/usr/sbin/ioreg", ["-r", "-d", "2", "-w", "0", "-c", "IOAccelerator"]), sh("/usr/sbin/ioreg", ["-r", "-w", "0", "-c", "IOBlockStorageDriver"])]);
  return {
    at: Date.now(),
    procs: merge(psOut, probe),
    probe: probe?.procs ?? null,
    net: parseNettop(netOut),
    gpuTime: probe ? probe.gpuTime : parseGpuClients(gpuOut),
    cpus: os.cpus(),
    disk: probe?.disk ?? parseDiskStats(diskOut),
    wire: parseNetstat(wireOut),
    vm: parseVmStat(vmOut),
    sysctl: parseSysctl(sysOut),
    gpu: probe ? probe.gpu : parseGpu(gpuOut),
  };
}

/** A fresh table of processes and listening ports, for acting on: never the cached one. */
export async function readTable(): Promise<{ procs: ProcInfo[]; listening: Map<number, number[]> }> {
  const [{ psOut, probe }, lsofOut] = await Promise.all([table(), sh("/usr/sbin/lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pn"])]);
  return { procs: merge(psOut, probe), listening: parseListeners(lsofOut) };
}

/* ── what changes slowly ───────────────────────────────────────────────── */

interface Slow {
  at: number;
  listening: Map<number, number[]>;
  commands: Map<number, string>;
  battery: BatteryReading | null;
  space: { total: number; free: number };
  iface: VitalsNetwork["iface"];
}

const SLOW_MS = 10_000;
let slow: Slow | null = null;
let slowPending: Promise<Slow> | null = null;
let ifaceNames: { at: number; names: Map<string, string> } | null = null;

async function interfaceNow(): Promise<VitalsNetwork["iface"]> {
  if (!ifaceNames || Date.now() - ifaceNames.at > 10 * 60_000) {
    ifaceNames = { at: Date.now(), names: parseHardwarePorts(await sh("/usr/sbin/networksetup", ["-listallhardwareports"])) };
  }
  const device = parseDefaultRoute(await sh("/sbin/route", ["-n", "get", "default"]));
  if (!device) return null;
  const name = ifaceNames.names.get(device) ?? (device.startsWith("utun") ? "VPN" : device);
  return { device, name };
}

function diskSpace(): { total: number; free: number } {
  for (const volume of ["/System/Volumes/Data", "/"]) {
    try {
      const s = fs.statfsSync(volume);
      return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
    } catch {
      /* try the next */
    }
  }
  return { total: 0, free: 0 };
}

async function readSlow(): Promise<Slow> {
  const [lsofOut, batteryOut, iface] = await Promise.all([
    sh("/usr/sbin/lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pn"]),
    sh("/usr/sbin/ioreg", ["-rn", "AppleSmartBattery", "-w", "0"]),
    interfaceNow(),
  ]);
  const listening = parseListeners(lsofOut);
  const commands = new Map<number, string>();
  if (listening.size) {
    const out = await sh("/bin/ps", ["-ww", "-o", "pid=,command=", "-p", [...listening.keys()].join(",")]);
    for (const line of out.split("\n")) {
      const m = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (m) commands.set(Number(m[1]), m[2]!);
    }
  }
  return { at: Date.now(), listening, commands, battery: parseBattery(batteryOut), space: diskSpace(), iface };
}

function slowNow(): Promise<Slow> {
  if (slow && Date.now() - slow.at < SLOW_MS) return Promise.resolve(slow);
  slowPending ??= readSlow()
    .then((value) => (slow = value))
    .finally(() => (slowPending = null));
  return slowPending;
}

/** After stopping or quitting something, the ports list is out of date at once. */
export function forgetSlow() {
  slow = null;
}

/* ── projects ──────────────────────────────────────────────────────────── */

const MANIFESTS = ["package.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod", "Gemfile", "composer.json", "deno.json", "pom.xml", "build.gradle", "mix.exs"];
const roots = new Map<string, { at: number; info: RootInfo | null }>();

/** The project a folder belongs to: its git repository, else the nearest folder with a manifest. */
export function rootOf(cwd: string): RootInfo | null {
  if (!cwd.startsWith("/") || /^\/(System|usr|bin|sbin|Library|Applications|private\/var\/db)(\/|$)/.test(cwd)) return null;
  const cached = roots.get(cwd);
  if (cached && Date.now() - cached.at < 60_000) return cached.info;
  const home = os.homedir();
  let manifest: string | null = null;
  let repo: string | null = null;
  for (let d = cwd, hops = 0; hops < 16 && d !== home && d !== "/"; hops++, d = path.dirname(d)) {
    if (!manifest && MANIFESTS.some((m) => fs.existsSync(path.join(d, m)))) manifest = d;
    if (fs.existsSync(path.join(d, ".git"))) {
      repo = d;
      break;
    }
  }
  const root = repo ?? manifest;
  const info = root ? { root, name: path.basename(root), sub: manifest && manifest !== root ? path.relative(root, manifest) : null } : null;
  roots.set(cwd, { at: Date.now(), info });
  return info;
}

/* ── one snapshot ──────────────────────────────────────────────────────── */

let host: Omit<VitalsHost, "uptime"> | null = null;
let efficiencyCores = 0;

async function hostInfo(): Promise<Omit<VitalsHost, "uptime">> {
  if (host) return host;
  const [sysOut, name] = await Promise.all([
    sh("/usr/sbin/sysctl", ["machdep.cpu.brand_string", "kern.osproductversion", "hw.perflevel1.logicalcpu"]),
    sh("/usr/sbin/scutil", ["--get", "ComputerName"]),
  ]);
  const sys = parseSysctl(sysOut);
  efficiencyCores = Number(sys.get("hw.perflevel1.logicalcpu")) || 0;
  host = {
    name: name.trim() || os.hostname(),
    chip: sys.get("machdep.cpu.brand_string") ?? os.cpus()[0]?.model ?? "Mac",
    os: `macOS ${sys.get("kern.osproductversion") ?? os.release()}`,
    memory: os.totalmem(),
  };
  return host;
}

const busyOf = (t: os.CpuInfo["times"]) => t.user + t.nice + t.sys + t.irq;
const allOf = (t: os.CpuInfo["times"]) => busyOf(t) + t.idle;

function rates(prev: Reading, cur: Reading): ProcLive[] {
  const dt = Math.max(0.2, (cur.at - prev.at) / 1000);
  const before = new Map(prev.procs.map((p) => [p.pid, p]));
  return cur.procs.map((p) => {
    const was = before.get(p.pid);
    // A pid handed to a new process since the last reading starts from zero.
    const fresh = !was || was.path !== p.path || was.uptime > p.uptime + 2;
    const born = p.uptime <= dt + 1;
    const per = (now: number | undefined, then: number | undefined): number | null => {
      if (now === undefined) return null;
      if (!fresh) return then === undefined ? null : Math.max(0, now - then) / dt;
      return born ? now / dt : null;
    };
    const probeNow = cur.probe?.get(p.pid);
    const probeThen = prev.probe?.get(p.pid);
    const netNow = cur.net.get(p.pid);
    const netThen = prev.net.get(p.pid);
    const gpu = per(cur.gpuTime.get(p.pid) ?? 0, prev.gpuTime.get(p.pid) ?? 0) ?? 0;
    const energy = per(probeNow?.energy, probeThen?.energy);
    return {
      ...p,
      cpu: (per(p.cpuTime, was?.cpuTime) ?? 0) * 100,
      power: energy === null ? null : energy / 1e9,
      read: per(probeNow?.read, probeThen?.read),
      write: per(probeNow?.write, probeThen?.write),
      down: per(netNow?.down ?? 0, netThen?.down ?? 0) ?? 0,
      up: per(netNow?.up ?? 0, netThen?.up ?? 0) ?? 0,
      gpu: Math.min(100, (gpu / 1e9) * 100),
    };
  });
}

function cpuOf(prev: Reading, cur: Reading, appsCpu: number): VitalsCpu {
  let busy = 0;
  let all = 0;
  const cores = cur.cpus.map((core, i) => {
    const then = prev.cpus[i]?.times;
    const b = then ? busyOf(core.times) - busyOf(then) : 0;
    const a = then ? allOf(core.times) - allOf(then) : 0;
    busy += b;
    all += a;
    const kind: "P" | "E" | null = efficiencyCores ? (i < efficiencyCores ? "E" : "P") : null;
    return { kind, busy: a > 0 ? Math.min(100, (b / a) * 100) : 0 };
  });
  const total = all > 0 ? Math.min(100, (busy / all) * 100) : 0;
  const apps = Math.min(total, appsCpu / Math.max(1, cur.cpus.length));
  const [one, five, fifteen] = os.loadavg();
  return { total, apps, macos: Math.max(0, total - apps), load: [one ?? 0, five ?? 0, fifteen ?? 0], cores };
}

function memoryOf(cur: Reading): VitalsMemory {
  const { vm } = cur;
  const page = vm.pageSize;
  const total = os.totalmem();
  const app = Math.max(0, vm.anonymous - vm.purgeable) * page;
  const wired = vm.wired * page;
  const compressed = vm.compressor * page;
  const cached = (vm.fileBacked + vm.purgeable) * page;
  const used = app + wired + compressed;
  const swap = parseSwap(cur.sysctl.get("vm.swapusage"));
  const level = Number(cur.sysctl.get("kern.memorystatus_vm_pressure_level"));
  return {
    total,
    used,
    app,
    wired,
    compressed,
    cached,
    free: Math.max(0, total - used - cached),
    swapUsed: swap.used,
    swapTotal: swap.total,
    pressure: level >= 4 ? "critical" : level >= 2 ? "warning" : "normal",
  };
}

let lastGpu: GpuReading | null = null;

/**
 * The GPU's own counters read 0 now and then between real readings. When the
 * apps' GPU time says it was busy, the reading before stands in.
 */
function steadyGpu(gpu: GpuReading | null, appsBusy: number): GpuReading | null {
  if (!gpu) return null;
  if (gpu.busy === 0 && appsBusy >= 1 && lastGpu) return { ...gpu, busy: lastGpu.busy, renderer: lastGpu.renderer, tiler: lastGpu.tiler };
  lastGpu = gpu;
  return gpu;
}

async function build(prev: Reading, cur: Reading): Promise<VitalsSnapshot> {
  const [info, later, missing] = await Promise.all([hostInfo(), slowNow(), cur.probe ? Promise.resolve(null) : probeMissing()]);
  const dt = Math.max(0.2, (cur.at - prev.at) / 1000);
  const uid = process.getuid?.() ?? 501;
  const procs = rates(prev, cur);
  const guard = protectedFrom(procs, process.pid);
  const apps = groupApps(procs, { uid, protectedBundles: guard.bundles });
  const { projects, ports } = projectsFrom(procs, later.listening, { uid, protectedPids: guard.pids, rootOf, commands: later.commands });
  const appsCpu = apps.filter((a) => a.kind !== "macos").reduce((sum, a) => sum + a.cpu, 0);

  return {
    at: cur.at,
    interval: cur.at - prev.at,
    host: { ...info, uptime: os.uptime() },
    cpu: cpuOf(prev, cur, appsCpu),
    memory: memoryOf(cur),
    gpu: steadyGpu(cur.gpu, procs.reduce((sum, p) => sum + p.gpu, 0)),
    disk: {
      total: later.space.total,
      free: later.space.free,
      read: Math.max(0, cur.disk.read - prev.disk.read) / dt,
      write: Math.max(0, cur.disk.written - prev.disk.written) / dt,
      readTotal: cur.disk.read,
      writtenTotal: cur.disk.written,
    },
    network: {
      down: Math.max(0, cur.wire.in - prev.wire.in) / dt,
      up: Math.max(0, cur.wire.out - prev.wire.out) / dt,
      inTotal: cur.wire.in,
      outTotal: cur.wire.out,
      iface: later.iface,
    },
    battery: later.battery,
    apps,
    projects,
    ports,
    detailed: !!cur.probe,
    note: missing,
  };
}

let previous: Reading | null = null;
let latest: VitalsSnapshot | null = null;
let pending: Promise<VitalsSnapshot> | null = null;

/** A reading at most a second old. Two windows asking at once share one. */
export function snapshot(): Promise<VitalsSnapshot> {
  if (latest && Date.now() - latest.at < 1_000) return Promise.resolve(latest);
  pending ??= (async () => {
    let cur = await read();
    // No reading to compare with, or one from a visit long gone: take a second, a moment later.
    if (!previous || cur.at - previous.at > 30_000) {
      previous = cur;
      await new Promise((r) => setTimeout(r, 800));
      cur = await read();
    }
    const snap = await build(previous, cur);
    previous = cur;
    latest = snap;
    return snap;
  })().finally(() => {
    pending = null;
  });
  return pending;
}
