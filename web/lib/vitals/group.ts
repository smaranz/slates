import path from "node:path";

import type { AppKind, ServerState, VitalsApp, VitalsPort, VitalsProc, VitalsProject, VitalsServer } from "./types";

/**
 * A thousand processes into sixty apps, dev servers into the projects they
 * run from, and what the room may stop. All pure: the sampler hands in what
 * it read, the tests hand in fixtures.
 */

/** A process as read, before rates. */
export interface ProcInfo {
  pid: number;
  ppid: number;
  pgid: number;
  uid: number;
  path: string;
  /** Seconds up, and seconds of CPU used since. */
  uptime: number;
  cpuTime: number;
  mem: number;
  /** The process macOS holds responsible (the app that launched it); 0 when unknown. */
  responsible: number;
  cwd: string | null;
}

/** A process with what it's doing per second. */
export interface ProcLive extends ProcInfo {
  cpu: number;
  power: number | null;
  read: number | null;
  write: number | null;
  down: number;
  up: number;
  gpu: number;
}

const SHELLS = new Set(["zsh", "bash", "sh", "fish", "dash", "tcsh", "csh", "ksh", "nu", "login", "tmux", "screen", "sudo", "su"]);
const SYSTEM_PREFIXES = ["/System/", "/usr/libexec/", "/usr/sbin/", "/sbin/", "/Library/Apple/"];

export function baseName(p: string): string {
  return p.includes("/") ? path.posix.basename(p) : p;
}

/** The outermost .app a path is inside, or is. */
export function bundleOf(p: string): string | null {
  const i = p.indexOf(".app/");
  if (i >= 0) return p.slice(0, i + 4);
  return p.endsWith(".app") ? p : null;
}

/** macOS's own bundles (Finder, Dock, Control Center…) count as macOS; its apps (Mail, Safari) don't. */
function systemBundle(bundle: string): boolean {
  return bundle.startsWith("/System/") && !bundle.includes("/Applications/");
}

function systemProcess(p: ProcInfo): boolean {
  if (p.pid <= 1) return true;
  // No path is the kernel's or root's; a user process without one renamed itself (`next-server`).
  if (!p.path.startsWith("/")) return p.uid === 0;
  if (SYSTEM_PREFIXES.some((prefix) => p.path.startsWith(prefix))) return true;
  return p.uid === 0 && p.path.startsWith("/usr/");
}

export function appName(bundle: string): string {
  return path.posix.basename(bundle, ".app");
}

function isShell(p: ProcInfo): boolean {
  return SHELLS.has(baseName(p.path).replace(/^-/, ""));
}

const MACOS = { key: "macos", name: "macOS", kind: "macos" as AppKind, bundle: null };

/** Which app a process is filed under: the one macOS holds responsible for it, else the nearest app above it. */
export function ownerOf(p: ProcInfo, byPid: Map<number, ProcInfo>): { key: string; name: string; kind: AppKind; bundle: string | null } {
  const owner = (p.responsible > 0 && byPid.get(p.responsible)) || p;
  let bundle = bundleOf(owner.path) ?? bundleOf(p.path);
  if (!bundle && p.responsible <= 0) {
    // Without the probe there's no responsibility to ask, so climb the parents.
    let q = byPid.get(p.ppid);
    for (let hops = 0; q && q.pid > 1 && hops < 32; hops++, q = byPid.get(q.ppid)) {
      bundle = bundleOf(q.path);
      if (bundle) break;
    }
  }
  if (bundle) return systemBundle(bundle) ? MACOS : { key: bundle, name: appName(bundle), kind: "app", bundle };
  if (systemProcess(owner)) return MACOS;
  const name = baseName(owner.path);
  return { key: `tool:${name}`, name, kind: "tool", bundle: null };
}

/** What Slates itself runs in: this server and everything above it, and the app that launched it. Never offered for stopping. */
export function protectedFrom(procs: ProcInfo[], selfPid: number): { pids: Set<number>; bundles: Set<string> } {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const pids = new Set<number>([selfPid]);
  const bundles = new Set<string>();
  let p = byPid.get(selfPid);
  for (let hops = 0; p && p.pid > 1 && hops < 64; hops++, p = byPid.get(p.ppid)) {
    pids.add(p.pid);
    const bundle = bundleOf(p.path);
    if (bundle) bundles.add(bundle);
  }
  const self = byPid.get(selfPid);
  const responsible = self && self.responsible > 0 ? byPid.get(self.responsible) : undefined;
  if (responsible) {
    pids.add(responsible.pid);
    const bundle = bundleOf(responsible.path);
    if (bundle) bundles.add(bundle);
  }
  return { pids, bundles };
}

/** An app's own process: its executable, started by launchd. */
function mainProcesses(bundle: string, procs: ProcInfo[], uid: number): ProcInfo[] {
  const own = procs.filter((p) => p.uid === uid && p.path.startsWith(`${bundle}/Contents/MacOS/`));
  const launched = own.filter((p) => p.ppid === 1);
  return launched.length ? launched : own;
}

/**
 * A figure only some processes could be read for (power and disk come from the
 * probe, which can't see root's): the sum when the unread ones are a small part
 * of the app, else unknown, so macOS doesn't read as drawing a quarter of a watt.
 */
function partial(members: ProcLive[], pick: (p: ProcLive) => number | null): number | null {
  const unread = members.filter((p) => pick(p) === null);
  if (!unread.length) return members.reduce((a, p) => a + (pick(p) ?? 0), 0);
  const cpu = members.reduce((a, p) => a + p.cpu, 0);
  const share = cpu > 0.5 ? unread.reduce((a, p) => a + p.cpu, 0) / cpu : unread.length / members.length;
  return share > 0.1 ? null : members.reduce((a, p) => a + (pick(p) ?? 0), 0);
}

export function groupApps(procs: ProcLive[], opts: { uid: number; protectedBundles: Set<string> }): VitalsApp[] {
  const byPid = new Map<number, ProcInfo>(procs.map((p) => [p.pid, p]));
  const groups = new Map<string, { owner: ReturnType<typeof ownerOf>; procs: ProcLive[] }>();
  for (const p of procs) {
    const owner = ownerOf(p, byPid);
    const group = groups.get(owner.key);
    if (group) group.procs.push(p);
    else groups.set(owner.key, { owner, procs: [p] });
  }

  const apps: VitalsApp[] = [];
  for (const { owner, procs: members } of groups.values()) {
    members.sort((a, b) => b.cpu - a.cpu || b.mem - a.mem);
    const list: VitalsProc[] = members.map((p) => ({
      pid: p.pid,
      name: baseName(p.path),
      cpu: p.cpu,
      mem: p.mem,
      power: p.power,
      read: p.read,
      write: p.write,
      down: p.down,
      up: p.up,
      gpu: p.gpu,
    }));
    const quittable =
      owner.kind === "app" && !!owner.bundle && !opts.protectedBundles.has(owner.bundle) && mainProcesses(owner.bundle, members, opts.uid).length > 0;
    apps.push({
      ...owner,
      cpu: list.reduce((a, p) => a + p.cpu, 0),
      mem: list.reduce((a, p) => a + p.mem, 0),
      power: partial(members, (p) => p.power),
      read: partial(members, (p) => p.read),
      write: partial(members, (p) => p.write),
      down: list.reduce((a, p) => a + p.down, 0),
      up: list.reduce((a, p) => a + p.up, 0),
      gpu: list.reduce((a, p) => a + p.gpu, 0),
      quittable,
      procs: list,
    });
  }
  return apps.sort((a, b) => b.cpu - a.cpu || b.mem - a.mem);
}

/* ── dev servers, by project ───────────────────────────────────────────── */

export interface RootInfo {
  /** The repository (or, outside git, the folder with the manifest). */
  root: string;
  name: string;
  /** The package inside it the server runs from ("web"), when that isn't the root. */
  sub: string | null;
}

/** Working: busy now. Quiet: up an hour or more, and has averaged under half a percent of a core since it started. */
export function serverState(cpu: number, uptime: number, cpuTime: number): ServerState {
  if (cpu >= 1.5) return "working";
  if (uptime >= 3600 && cpuTime / uptime < 0.005) return "quiet";
  return "idle";
}

/**
 * What a server calls itself, in a word or two: the title it set
 * (`next-server (v16.3.5)`), else its program and script (`node server.js`).
 * Only base names, so no paths or arguments (or the secrets in them) leave.
 */
export function runtimeLabel(exe: string, command: string | undefined): string {
  const program = baseName(exe);
  const cmd = (command ?? "").trim();
  if (!cmd) return program;
  const first = cmd.split(/\s+/)[0]!;
  if (first !== exe && baseName(first) !== program) {
    /*
     * A title longer than the arguments it replaced runs on into the
     * environment, which `ps` then prints as if it were more of the title
     * (`next-server (v PATH=/Users/…`). Stop before anything shaped like
     * NAME=value, and drop a bracket the cut left open.
     */
    let title = cmd.split(/\s+(?=[A-Za-z_][A-Za-z0-9_]*=)/)[0]!.trim();
    if ((title.match(/\(/g) ?? []).length > (title.match(/\)/g) ?? []).length) title = title.slice(0, title.lastIndexOf("(")).trim();
    return title.slice(0, 40).trim() || program;
  }
  const script = cmd
    .split(/\s+/)
    .slice(1)
    .find((arg) => arg && !arg.startsWith("-") && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg));
  return script ? `${program} ${baseName(script)}`.slice(0, 40) : program;
}

function inside(dir: string, root: string): boolean {
  return dir === root || dir.startsWith(`${root}/`);
}

export function projectsFrom(
  procs: ProcLive[],
  listeners: Map<number, number[]>,
  opts: { uid: number; protectedPids: Set<number>; rootOf: (cwd: string) => RootInfo | null; commands: Map<number, string> },
): { projects: VitalsProject[]; ports: VitalsPort[] } {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const children = new Map<number, ProcLive[]>();
  for (const p of procs) {
    const list = children.get(p.ppid);
    if (list) list.push(p);
    else children.set(p.ppid, [p]);
  }
  const descendants = (pid: number): ProcLive[] => {
    const out: ProcLive[] = [];
    const queue = [...(children.get(pid) ?? [])];
    while (queue.length && out.length < 256) {
      const next = queue.shift()!;
      out.push(next);
      queue.push(...(children.get(next.pid) ?? []));
    }
    return out;
  };

  const projects = new Map<string, { info: RootInfo; servers: VitalsServer[]; members: Set<number> }>();
  const ports: VitalsPort[] = [];

  for (const [pid, held] of listeners) {
    const p = byPid.get(pid);
    if (!p) continue;
    const bundle = bundleOf(p.path);
    const info = p.uid === opts.uid && !bundle && p.cwd ? opts.rootOf(p.cwd) : null;
    if (!info) {
      const name = bundle ? appName(bundle) : baseName(p.path);
      for (const port of held) ports.push({ port, pid, name });
      continue;
    }
    const family = [p, ...descendants(pid)];
    const server: VitalsServer = {
      pid,
      name: info.sub ? baseName(info.sub) : info.name,
      runtime: runtimeLabel(p.path, opts.commands.get(pid)),
      ports: held,
      mem: family.reduce((a, q) => a + q.mem, 0),
      cpu: family.reduce((a, q) => a + q.cpu, 0),
      uptime: p.uptime,
      cpuTime: p.cpuTime,
      state: serverState(family.reduce((a, q) => a + q.cpu, 0), p.uptime, p.cpuTime),
      locked: opts.protectedPids.has(pid) ? "Slates is running from it" : null,
    };
    const project = projects.get(info.root) ?? { info, servers: [], members: new Set<number>() };
    project.servers.push(server);
    for (const q of family) project.members.add(q.pid);
    projects.set(info.root, project);
  }

  // Everything else run from the project's folder counts too (watchers, npm's `sh -c`), but not the shells it was typed into, which lead their own group.
  for (const p of procs) {
    if (p.uid !== opts.uid || !p.cwd || bundleOf(p.path) || (isShell(p) && p.pgid === p.pid)) continue;
    for (const project of projects.values()) {
      if (inside(p.cwd, project.info.root)) project.members.add(p.pid);
    }
  }

  const list: VitalsProject[] = [...projects.values()].map(({ info, servers, members }) => {
    const family = [...members].map((pid) => byPid.get(pid)!).filter(Boolean);
    return {
      root: info.root,
      name: info.name,
      procs: family.length,
      mem: family.reduce((a, q) => a + q.mem, 0),
      cpu: family.reduce((a, q) => a + q.cpu, 0),
      servers: servers.sort((a, b) => (a.ports[0] ?? 0) - (b.ports[0] ?? 0)),
    };
  });
  return {
    projects: list.sort((a, b) => b.mem - a.mem),
    ports: ports.sort((a, b) => a.port - b.port),
  };
}

/* ── what may be stopped or quit ───────────────────────────────────────── */

export type StopPlan =
  /** Ctrl-C's way: the whole job it was started as (`npm run dev` and its children). */
  | { kind: "group"; pgid: number; pids: number[] }
  /** Only the server and what it started, when its job holds something that mustn't go. */
  | { kind: "pids"; pids: number[] }
  | { kind: "refuse"; reason: string };

export function stopPlan(pid: number, procs: ProcInfo[], opts: { uid: number; protectedPids: Set<number>; listening: Set<number> }): StopPlan {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const p = byPid.get(pid);
  if (!p) return { kind: "refuse", reason: "It has already stopped." };
  if (p.uid !== opts.uid) return { kind: "refuse", reason: "It belongs to another user on this Mac." };
  if (opts.protectedPids.has(pid)) return { kind: "refuse", reason: "Slates is running from it." };
  if (bundleOf(p.path)) return { kind: "refuse", reason: "It's part of an app. Quit the app instead." };
  if (!opts.listening.has(pid)) return { kind: "refuse", reason: "It isn't serving on a port any more." };

  const safe = (q: ProcInfo) => q.uid === opts.uid && !opts.protectedPids.has(q.pid) && !isShell(q) && !bundleOf(q.path);
  /*
   * The whole job only when it is a job: led by something that isn't a shell
   * (npm, not the terminal's zsh or an agent's bash), with any shell in it
   * started under that leader, the way `npm run` wraps a script in `sh -c`.
   */
  const leader = byPid.get(p.pgid);
  const under = (q: ProcInfo) => {
    let up = byPid.get(q.ppid);
    for (let hops = 0; up && hops < 32; hops++, up = byPid.get(up.ppid)) if (up.pid === p.pgid) return true;
    return false;
  };
  const job = procs.filter((q) => q.pgid === p.pgid);
  const jobSafe = job.every((q) => q.uid === opts.uid && !opts.protectedPids.has(q.pid) && !bundleOf(q.path) && (!isShell(q) || under(q)));
  if (p.pgid > 1 && leader && safe(leader) && job.length <= 64 && jobSafe) return { kind: "group", pgid: p.pgid, pids: job.map((q) => q.pid) };

  const family: number[] = [];
  const queue = [pid];
  while (queue.length && family.length < 256) {
    const next = queue.shift()!;
    const q = byPid.get(next);
    if (!q || !safe(q)) continue;
    family.push(next);
    for (const child of procs) if (child.ppid === next) queue.push(child.pid);
  }
  return { kind: "pids", pids: family };
}

export type QuitPlan = { kind: "quit"; name: string; pids: number[] } | { kind: "refuse"; reason: string };

export function quitPlan(key: string, procs: ProcInfo[], opts: { uid: number; protectedBundles: Set<string> }): QuitPlan {
  const bundle = bundleOf(key);
  if (!bundle || bundle !== key) return { kind: "refuse", reason: "Only apps can be quit from here." };
  if (systemBundle(bundle)) return { kind: "refuse", reason: "That's part of macOS." };
  if (opts.protectedBundles.has(bundle)) return { kind: "refuse", reason: "Slates is running inside it." };
  const main = mainProcesses(bundle, procs, opts.uid);
  if (!main.length) return { kind: "refuse", reason: `${appName(bundle)} isn't running.` };
  return { kind: "quit", name: appName(bundle), pids: main.map((p) => p.pid) };
}
