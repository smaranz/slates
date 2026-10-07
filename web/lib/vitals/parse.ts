/**
 * Reading what macOS's own tools print. Each function takes one command's
 * output and gives back plain numbers, so the sampler can run the commands
 * and the tests can feed these fixtures.
 */

import type { ThermalPressure, VitalsFan, VitalsTemp, VitalsThermal } from "./types";

/** One row of `ps -axww -o pid=,ppid=,pgid=,uid=,time=,rss=,etime=,comm=`. */
export interface PsRow {
  pid: number;
  ppid: number;
  pgid: number;
  uid: number;
  /** Seconds of CPU, user and system together. */
  cpuTime: number;
  /** Bytes resident. */
  rss: number;
  /** Seconds since it started. */
  uptime: number;
  /** The executable's path (or bare name, for the kernel). */
  path: string;
}

/** With the executable's path last, for when nothing else can say it. */
export const PS_ARGS = ["-axww", "-o", "pid=,ppid=,pgid=,uid=,time=,rss=,etime=,comm="];
/** Half the work: the short name, when the probe brings the paths. */
export const PS_SHORT_ARGS = ["-axww", "-o", "pid=,ppid=,pgid=,uid=,time=,rss=,etime=,ucomm="];

/** "1-02:03:04.50", "62:45.31", "0:00.21" → seconds. Days are joined to the rest by a dash. */
export function clockSeconds(text: string): number {
  const [days, rest] = text.includes("-") ? [Number(text.split("-")[0]), text.slice(text.indexOf("-") + 1)] : [0, text];
  const parts = rest.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n)) || !Number.isFinite(days)) return 0;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return days * 86_400 + seconds;
}

export function parsePs(out: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    rows.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      pgid: Number(m[3]),
      uid: Number(m[4]),
      cpuTime: clockSeconds(m[5]!),
      rss: Number(m[6]) * 1024,
      uptime: clockSeconds(m[7]!),
      path: m[8]!,
    });
  }
  return rows;
}

/** What the probe adds for the student's own processes. */
export interface ProbeRow {
  pid: number;
  /** The process macOS holds responsible for this one: the app that launched it. 0 when unknown. */
  responsible: number;
  footprint: number;
  /** Nanojoules billed since it started. */
  energy: number;
  read: number;
  write: number;
  cwd: string;
}

export interface GpuReading {
  name: string;
  cores: number | null;
  busy: number;
  renderer: number;
  tiler: number;
  mem: number;
}

export interface Probe {
  /** Every process's executable, root's included. */
  paths: Map<number, string>;
  procs: Map<number, ProbeRow>;
  gpu: GpuReading | null;
  /** Nanoseconds of GPU time per process. */
  gpuTime: Map<number, number>;
  disk: { read: number; written: number } | null;
}

const pct = (n: number) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));

/** The probe's tagged lines (see probe.ts). */
export function parseProbe(out: string): Probe {
  const probe: Probe = { paths: new Map(), procs: new Map(), gpu: null, gpuTime: new Map(), disk: null };
  for (const line of out.split("\n")) {
    const f = line.split("\t");
    const pid = Number(f[1]);
    switch (f[0]) {
      case "X":
        if (Number.isInteger(pid) && pid >= 0 && f[2]) probe.paths.set(pid, f.slice(2).join("\t"));
        break;
      case "P":
        if (!Number.isInteger(pid) || pid < 0 || f.length < 8) break;
        probe.procs.set(pid, {
          pid,
          responsible: Number(f[2]) || 0,
          footprint: Number(f[3]) || 0,
          energy: Number(f[4]) || 0,
          read: Number(f[5]) || 0,
          write: Number(f[6]) || 0,
          cwd: f.slice(7).join("\t"),
        });
        break;
      case "G":
        // The first accelerator is the Mac's GPU.
        if (!probe.gpu && f.length >= 7) {
          const cores = Number(f[5]);
          probe.gpu = { name: f.slice(6).join("\t") || "GPU", cores: cores > 0 ? cores : null, busy: pct(Number(f[1])), renderer: pct(Number(f[2])), tiler: pct(Number(f[3])), mem: Number(f[4]) || 0 };
        }
        break;
      case "C":
        if (Number.isInteger(pid) && pid > 0) probe.gpuTime.set(pid, (probe.gpuTime.get(pid) ?? 0) + (Number(f[2]) || 0));
        break;
      case "D":
        probe.disk = { read: Number(f[1]) || 0, written: Number(f[2]) || 0 };
        break;
    }
  }
  return probe;
}

/** `nettop -P -L 1 -x -J bytes_in,bytes_out`: "name.pid,in,out," per process, bytes since it started. */
export function parseNettop(out: string): Map<number, { down: number; up: number }> {
  const rows = new Map<number, { down: number; up: number }>();
  for (const line of out.split("\n")) {
    const f = line.split(",");
    if (f.length < 3) continue;
    const dot = f[0]!.lastIndexOf(".");
    const pid = Number(f[0]!.slice(dot + 1));
    if (dot < 0 || !Number.isInteger(pid) || pid <= 0) continue;
    const down = Number(f[1]);
    const up = Number(f[2]);
    if (!Number.isFinite(down) || !Number.isFinite(up)) continue;
    const seen = rows.get(pid);
    rows.set(pid, seen ? { down: seen.down + down, up: seen.up + up } : { down, up });
  }
  return rows;
}

export interface VmStat {
  pageSize: number;
  free: number;
  speculative: number;
  wired: number;
  anonymous: number;
  fileBacked: number;
  purgeable: number;
  compressor: number;
}

/** `vm_stat`, in pages, with the page size from its first line. */
export function parseVmStat(out: string): VmStat {
  const pages = (label: string) => {
    const m = new RegExp(`^${label.replace(/[()]/g, "\\$&")}:\\s+(\\d+)`, "m").exec(out);
    return m ? Number(m[1]) : 0;
  };
  const size = /page size of (\d+) bytes/.exec(out);
  return {
    pageSize: size ? Number(size[1]) : 16_384,
    free: pages("Pages free"),
    speculative: pages("Pages speculative"),
    wired: pages("Pages wired down"),
    anonymous: pages("Anonymous pages"),
    fileBacked: pages("File-backed pages"),
    purgeable: pages("Pages purgeable"),
    compressor: pages("Pages occupied by compressor"),
  };
}

/** `sysctl a b c`: "name: value" lines, as a map. Missing names just aren't in it. */
export function parseSysctl(out: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of out.split("\n")) {
    const i = line.indexOf(": ");
    if (i > 0) map.set(line.slice(0, i).trim(), line.slice(i + 2).trim());
  }
  return map;
}

/** "total = 12800.00M  used = 11947.44M  free = 852.56M  (encrypted)" → bytes. */
export function parseSwap(text: string | undefined): { used: number; total: number } {
  const size = (label: string) => {
    const m = new RegExp(`${label} = ([\\d.]+)([KMGT])`).exec(text ?? "");
    if (!m) return 0;
    const unit = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }[m[2] as "K" | "M" | "G" | "T"];
    return Math.round(Number(m[1]) * unit);
  };
  return { used: size("used"), total: size("total") };
}

const TWO_63 = BigInt(2) ** BigInt(63);
const TWO_64 = BigInt(2) ** BigInt(64);

/** A number ioreg printed. Signed values come out as their unsigned 64-bit form, which doubles can't hold. */
export function ioNumber(text: string): number {
  if (!/^-?\d+$/.test(text)) return Number.NaN;
  const big = BigInt(text);
  return Number(big >= TWO_63 ? big - TWO_64 : big);
}

/** The top-level `"Key" = value` lines of one ioreg object (nested dictionaries print as `"Key"=value`). */
export function ioProps(out: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of out.split("\n")) {
    const m = /^[\s|]*"([^"]+)" = (.*)$/.exec(line);
    if (m && !map.has(m[1]!)) map.set(m[1]!, m[2]!.trim());
  }
  return map;
}

/** A value inside an ioreg dictionary: `"Key"=123` or `"Key"="text"`. */
export function ioField(dict: string, key: string): string | null {
  const m = new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\%]/g, "\\$&")}"=("([^"]*)"|[^,}]+)`).exec(dict);
  return m ? (m[2] ?? m[1]!) : null;
}

/** `ioreg -r -d 2 -w 0 -c IOAccelerator`: the GPU's model, cores and how busy it is (its own lines come before its clients'). */
export function parseGpu(out: string): GpuReading | null {
  const props = ioProps(out);
  const stats = props.get("PerformanceStatistics");
  if (!stats) return null;
  const share = (key: string) => pct(Number(ioField(stats, key)));
  const cores = Number(props.get("gpu-core-count"));
  return {
    name: (props.get("model") ?? "GPU").replace(/^"|"$/g, ""),
    cores: Number.isFinite(cores) && cores > 0 ? cores : null,
    busy: share("Device Utilization %"),
    renderer: share("Renderer Utilization %"),
    tiler: share("Tiler Utilization %"),
    mem: Number(ioField(stats, "In use system memory")) || 0,
  };
}

/**
 * The same output's clients: every app's connections to the GPU, each with
 * the process that opened it and the GPU time it has used. Nanoseconds per
 * pid, summed over its connections.
 */
export function parseGpuClients(out: string): Map<number, number> {
  const time = new Map<number, number>();
  for (const block of out.split(/\n(?=\+-o )/)) {
    const creator = /"IOUserClientCreator" = "pid (\d+),/.exec(block);
    if (!creator) continue;
    const pid = Number(creator[1]);
    let total = 0;
    for (const m of block.matchAll(/"accumulatedGPUTime"=(\d+)/g)) total += Number(m[1]);
    if (total > 0) time.set(pid, (time.get(pid) ?? 0) + total);
  }
  return time;
}

/** `ioreg -r -c IOBlockStorageDriver -w 0`: bytes read and written since boot, every disk together. */
export function parseDiskStats(out: string): { read: number; written: number } {
  let read = 0;
  let written = 0;
  for (const m of out.matchAll(/"Statistics" = (\{[^}]*\})/g)) {
    read += Number(ioField(m[1]!, "Bytes (Read)")) || 0;
    written += Number(ioField(m[1]!, "Bytes (Write)")) || 0;
  }
  return { read, written };
}

/**
 * `netstat -ibn`: bytes in and out since boot over the Mac's own network
 * ports (en0, en1…). Tunnels and loopback are left out, since a VPN's traffic
 * also crosses Wi-Fi and would count twice.
 */
export function parseNetstat(out: string): { in: number; out: number } {
  let inBytes = 0;
  let outBytes = 0;
  const seen = new Set<string>();
  for (const line of out.split("\n")) {
    const f = line.trim().split(/\s+/);
    const name = f[0]?.replace(/\*$/, "") ?? "";
    if (!/^en\d+$/.test(name) || !f[2]?.startsWith("<Link#") || seen.has(name) || f.length < 10) continue;
    seen.add(name);
    // Read from the right: an interface without an address has one column fewer.
    inBytes += Number(f[f.length - 5]) || 0;
    outBytes += Number(f[f.length - 2]) || 0;
  }
  return { in: inBytes, out: outBytes };
}

/** `lsof -nP -iTCP -sTCP:LISTEN -F pn`: the TCP ports each process is listening on. */
export function parseListeners(out: string): Map<number, number[]> {
  const ports = new Map<number, number[]>();
  let pid = 0;
  for (const line of out.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1)) || 0;
    else if (line.startsWith("n") && pid) {
      const port = Number(line.slice(line.lastIndexOf(":") + 1));
      if (!Number.isInteger(port) || port <= 0) continue;
      const list = ports.get(pid) ?? [];
      if (!list.includes(port)) list.push(port);
      ports.set(pid, list.sort((a, b) => a - b));
    }
  }
  return ports;
}

export interface BatteryReading {
  percent: number;
  charging: boolean;
  plugged: boolean;
  full: boolean;
  minutes: number | null;
  cycles: number;
  health: number;
  temperature: number | null;
  draw: number | null;
  adapter: { name: string; watts: number | null } | null;
}

/** `ioreg -rn AppleSmartBattery -w 0`; null on a Mac without a battery. */
export function parseBattery(out: string): BatteryReading | null {
  const props = ioProps(out);
  if (!props.has("CurrentCapacity") || props.get("BatteryInstalled") === "No") return null;
  const num = (key: string) => ioNumber(props.get(key) ?? "");
  const yes = (key: string) => props.get(key) === "Yes";

  const plugged = yes("ExternalConnected");
  const charging = yes("IsCharging");
  // 65535 is macOS still working it out.
  const time = num(charging ? "AvgTimeToFull" : "AvgTimeToEmpty");
  const fallback = num("TimeRemaining");
  const minutes = [time, fallback].find((n) => Number.isFinite(n) && n > 0 && n < 65_535) ?? null;

  const design = num("DesignCapacity");
  const max = [num("NominalChargeCapacity"), num("AppleRawMaxCapacity")].find((n) => Number.isFinite(n) && n > 0) ?? NaN;
  const health = design > 0 && max > 0 ? Math.min(100, Math.round((max / design) * 100)) : NaN;

  const amps = num("InstantAmperage");
  const volts = num("Voltage");
  const draw = !plugged && amps < 0 && volts > 0 ? (-amps * volts) / 1e6 : null;

  const temperature = num("Temperature");
  const details = props.get("AdapterDetails");
  const adapterName = details ? ioField(details, "Name") : null;
  const adapterWatts = details ? Number(ioField(details, "Watts")) : NaN;

  return {
    percent: Math.max(0, Math.min(100, num("CurrentCapacity") || 0)),
    charging,
    plugged,
    full: yes("FullyCharged"),
    minutes: plugged && !charging ? null : minutes,
    cycles: Math.max(0, num("CycleCount") || 0),
    health: Number.isFinite(health) ? health : 100,
    temperature: Number.isFinite(temperature) && temperature > 0 ? Math.round(temperature / 10) / 10 : null,
    draw,
    adapter: plugged ? { name: adapterName || "Power adapter", watts: adapterWatts > 0 ? adapterWatts : null } : null,
  };
}

/* ── heat ──────────────────────────────────────────────────────────────── */

export type SensorKind = "cpu" | "gpu" | "ssd";

/**
 * What an SMC temperature key measures, as far as anyone outside Apple knows:
 * Tp, Te and Ts are the CPU's clusters (performance, efficiency, M5's super
 * cores), Tg the GPU, and TH the SSD. The rest (the battery, which ioreg
 * already gives, airflow, skin, charger, Wi-Fi…) Vitals leaves out.
 */
export function sensorKind(key: string): SensorKind | null {
  if (/^T[pes]/.test(key)) return "cpu";
  if (key.startsWith("Tg")) return "gpu";
  if (key.startsWith("TH")) return "ssd";
  return null;
}

const PRESSURES: ThermalPressure[] = ["nominal", "moderate", "heavy", "trapping", "sleeping"];

/**
 * `probe sensors`, see probe.ts. Keys that read as a whole number or outside
 * 10–130 °C are limits and placeholders the SMC keeps beside its sensors
 * (an M4 Pro has six Tp keys stuck at 40 and dozens at 0 or below), so they
 * stay out of the averages.
 */
export function parseSensors(out: string): VitalsThermal | null {
  const groups: Record<SensorKind, number[]> = { cpu: [], gpu: [], ssd: [] };
  const fans: VitalsFan[] = [];
  let power: number | null = null;
  let pressure: ThermalPressure | null = null;
  let any = false;
  for (const line of out.split("\n")) {
    const f = line.split("\t");
    switch (f[0]) {
      case "T": {
        const kind = sensorKind(f[1] ?? "");
        const c = Number(f[2]);
        if (kind && Number.isFinite(c) && c > 10 && c < 130 && !Number.isInteger(c)) groups[kind].push(c);
        any = true;
        break;
      }
      case "F": {
        const [rpm, min, max, target] = f.slice(2, 6).map(Number) as [number, number, number, number];
        if (!Number.isFinite(rpm)) break;
        fans.push({
          rpm: Math.max(0, Math.round(rpm)),
          min: Math.max(0, min || 0),
          max: Math.max(0, max || 0),
          target: Number.isFinite(target) && target >= 0 ? target : null,
          manual: f[6] === "1",
        });
        any = true;
        break;
      }
      case "W": {
        const w = Number(f[1]);
        if (Number.isFinite(w) && w > 0 && w < 2000) power = w;
        any = true;
        break;
      }
      case "H":
        pressure = PRESSURES[Number(f[1])] ?? null;
        break;
    }
  }
  if (!any && !pressure) return null;
  const temp = (values: number[]): VitalsTemp | null =>
    values.length ? { avg: values.reduce((sum, v) => sum + v, 0) / values.length, max: Math.max(...values), sensors: values.length } : null;
  return { cpu: temp(groups.cpu), gpu: temp(groups.gpu), ssd: temp(groups.ssd), fans, power, pressure };
}

/** `networksetup -listallhardwareports`: device → the name System Settings uses ("en0" → "Wi-Fi"). */
export function parseHardwarePorts(out: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const m of out.matchAll(/Hardware Port: (.+)\nDevice: (\S+)/g)) names.set(m[2]!, m[1]!.trim());
  return names;
}

/** `route -n get default`: which interface the default route goes out of. */
export function parseDefaultRoute(out: string): string | null {
  return /interface: (\S+)/.exec(out)?.[1] ?? null;
}
