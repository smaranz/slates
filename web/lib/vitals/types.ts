/**
 * Vitals: what this Mac is doing right now, by app rather than by process.
 *
 * The shapes the Mac's portal sends the room. Rates are per second over the
 * gap since the last reading; CPU is a percentage of one core, the way
 * Activity Monitor counts it, so a busy app on a 12-core Mac can pass 100.
 */

export type VitalsTab = "overview" | "cpu" | "memory" | "disk" | "network" | "gpu" | "battery" | "thermal" | "projects";

/** One process, inside the app it belongs to. */
export interface VitalsProc {
  pid: number;
  name: string;
  /** % of one core. */
  cpu: number;
  /** Bytes: the memory footprint when the probe could read it, else resident size. */
  mem: number;
  /** Watts, from the energy the kernel bills it; null when it couldn't be read. */
  power: number | null;
  /** Bytes per second; null when it couldn't be read. */
  read: number | null;
  write: number | null;
  down: number;
  up: number;
  /** % of the GPU's time. */
  gpu: number;
}

export type AppKind = "app" | "macos" | "tool";

/** An app with every helper it launched, or macOS's own processes as one, or a command-line tool. */
export interface VitalsApp {
  key: string;
  name: string;
  kind: AppKind;
  /** The .app bundle, for its icon. */
  bundle: string | null;
  cpu: number;
  mem: number;
  power: number | null;
  read: number | null;
  write: number | null;
  down: number;
  up: number;
  gpu: number;
  /** Whether the room may offer to quit it. */
  quittable: boolean;
  procs: VitalsProc[];
}

export interface VitalsCpu {
  /** Everything busy, % of the whole chip. */
  total: number;
  /** The part your apps account for, and macOS's. */
  apps: number;
  macos: number;
  load: [number, number, number];
  cores: { kind: "P" | "E" | null; busy: number }[];
}

export interface VitalsMemory {
  total: number;
  /** App + wired + compressed, as Activity Monitor's "Memory Used". */
  used: number;
  app: number;
  wired: number;
  compressed: number;
  cached: number;
  free: number;
  swapUsed: number;
  swapTotal: number;
  pressure: "normal" | "warning" | "critical";
}

export interface VitalsGpu {
  name: string;
  cores: number | null;
  /** % busy. */
  busy: number;
  renderer: number;
  tiler: number;
  /** Bytes of system memory the GPU is using. */
  mem: number;
}

export interface VitalsDisk {
  total: number;
  free: number;
  /** Bytes per second across every disk. */
  read: number;
  write: number;
  /** Since the Mac started. */
  readTotal: number;
  writtenTotal: number;
}

export interface VitalsNetwork {
  /** Bytes per second. */
  down: number;
  up: number;
  /** Since the Mac started, every interface but loopback. */
  inTotal: number;
  outTotal: number;
  /** The interface the default route uses, by its macOS name. */
  iface: { device: string; name: string } | null;
}

export interface VitalsBattery {
  percent: number;
  charging: boolean;
  plugged: boolean;
  full: boolean;
  /** Minutes to empty (on battery) or full (charging); null while macOS is still working it out. */
  minutes: number | null;
  cycles: number;
  /** Maximum capacity against the design capacity, %. */
  health: number;
  /** °C. */
  temperature: number | null;
  /** Watts going out of the battery while on it. */
  draw: number | null;
  adapter: { name: string; watts: number | null } | null;
}

export interface VitalsFan {
  /** rpm; 0 while it's stopped, which Apple silicon Macs do when cool. */
  rpm: number;
  min: number;
  max: number;
  /** What macOS is steering it towards; null when the SMC doesn't say. */
  target: number | null;
  /** Set by hand (a fan-control app) rather than by macOS. */
  manual: boolean;
}

/** A group of the SMC's temperature sensors: their mean and the hottest, °C. */
export interface VitalsTemp {
  avg: number;
  max: number;
  sensors: number;
}

export type ThermalPressure = "nominal" | "moderate" | "heavy" | "trapping" | "sleeping";

export interface VitalsThermal {
  cpu: VitalsTemp | null;
  gpu: VitalsTemp | null;
  ssd: VitalsTemp | null;
  /** Empty on a Mac without fans. */
  fans: VitalsFan[];
  /** Watts the whole Mac is drawing, as the SMC measures it. */
  power: number | null;
  /** How hard macOS is holding the chip back to cool it; null when it doesn't say. */
  pressure: ThermalPressure | null;
}

export type ServerState = "working" | "idle" | "quiet";

/** A process listening on a port, run from a project folder. */
export interface VitalsServer {
  pid: number;
  /** The folder it runs from, inside the project ("web"), or the project's own name. */
  name: string;
  /** The program: node, python, go… or a title the server gave itself (next-server). */
  runtime: string;
  ports: number[];
  /** Bytes, with its child processes. */
  mem: number;
  cpu: number;
  /** Seconds it has been up, and seconds of CPU it has used in that time. */
  uptime: number;
  cpuTime: number;
  state: ServerState;
  /** Null when it may be stopped; otherwise why not. */
  locked: string | null;
}

export interface VitalsProject {
  root: string;
  name: string;
  procs: number;
  mem: number;
  cpu: number;
  servers: VitalsServer[];
}

/** A port held by something that isn't a project: an app, a tool, a system service. */
export interface VitalsPort {
  port: number;
  pid: number;
  name: string;
}

export interface VitalsHost {
  name: string;
  chip: string;
  os: string;
  memory: number;
  /** Seconds since boot. */
  uptime: number;
}

export interface VitalsSnapshot {
  at: number;
  /** Milliseconds between this reading and the one before it. */
  interval: number;
  host: VitalsHost;
  cpu: VitalsCpu;
  memory: VitalsMemory;
  gpu: VitalsGpu | null;
  disk: VitalsDisk;
  network: VitalsNetwork;
  battery: VitalsBattery | null;
  /** Null without the probe, or where the SMC can't be read. */
  thermal: VitalsThermal | null;
  apps: VitalsApp[];
  projects: VitalsProject[];
  ports: VitalsPort[];
  /** True when memory is each process's footprint and energy and disk are per app (the probe ran). */
  detailed: boolean;
  /** Why some figures are missing, said once. */
  note: string | null;
}

export type VitalsAction = { action: "quit"; app: string } | { action: "stop"; pids: number[] };

export interface VitalsActionResult {
  ok: boolean;
  /** What happened, in a sentence for the toast. */
  message: string;
  /** Bytes of memory freed, as measured just before. */
  freed?: number;
  ports?: number[];
}
