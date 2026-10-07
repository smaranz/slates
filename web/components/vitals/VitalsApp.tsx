"use client";

import { useEffect, useState, type ReactNode } from "react";

import { useMode } from "@/lib/mode";
import type { ThermalPressure, VitalsApp as App, VitalsFan, VitalsProject, VitalsServer, VitalsSnapshot, VitalsTab, VitalsTemp, VitalsThermal } from "@/lib/vitals/types";
import { Icon, ICON } from "../ui";
import AppTable from "./AppTable";
import { andList, celsius, duration, memory, pct, plural, rate, rpm, space, watts } from "./format";
import { Confirm, Meter, Spark, Stack, Toast, V } from "./parts";
import ProjectsView, { quietServers } from "./ProjectsView";
import { EVERY_MS, useAppIcons, useVitals, type Metric, type Trail } from "./useVitals";
import s from "./vitals.module.css";

/**
 * Vitals: what this Mac is doing, by app rather than by process.
 *
 * After vitalsmac.com, the Activity Monitor that groups every helper under the
 * app that launched it, so a thousand processes read as sixty apps. A tab for
 * each thing a Mac runs short of, the dev servers by project with the idle
 * ones pointed out, and a way to quit an app or stop a server, asked first.
 * Live only: it reads the Mac while the room is open and keeps nothing.
 */

const TABS: { id: VitalsTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "cpu", label: "CPU" },
  { id: "memory", label: "Memory" },
  { id: "disk", label: "Disk" },
  { id: "network", label: "Network" },
  { id: "gpu", label: "GPU" },
  { id: "battery", label: "Battery" },
  { id: "thermal", label: "Thermals" },
  { id: "projects", label: "Projects" },
];

const TAB_KEY = "slates.vitals.tab.v1";

/** The overview's small charts cover the last two minutes; a tab's large one the last five. */
const TILE_SLOTS = 48;

function savedTab(): VitalsTab {
  try {
    const saved = window.sessionStorage.getItem(TAB_KEY);
    return TABS.some((t) => t.id === saved) ? (saved as VitalsTab) : "overview";
  } catch {
    return "overview";
  }
}

type Stoppable = { project: VitalsProject; server: VitalsServer };
type Pending = { kind: "quit"; app: App } | { kind: "stop"; servers: Stoppable[] } | null;

export default function VitalsApp() {
  const { clear } = useMode();
  const vitals = useVitals();
  const { snap, trail } = vitals;
  const [tab, setTabState] = useState<VitalsTab>(savedTab);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "good" | "bad" } | null>(null);
  const iconOf = useAppIcons(snap?.apps.map((a) => a.bundle) ?? []);

  // The traffic lights sit over the header's left end in the desktop shell.
  useEffect(() => {
    if (navigator.userAgent.includes("Electron")) document.documentElement.dataset.desktop = "1";
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const tabs = TABS.filter((t) => (t.id !== "battery" || !!snap?.battery) && (t.id !== "gpu" || !!snap?.gpu) && (t.id !== "thermal" || !!snap?.thermal));
  const current = !snap || tabs.some((t) => t.id === tab) ? tab : "overview";
  const setTab = (next: VitalsTab) => {
    setTabState(next);
    try {
      window.sessionStorage.setItem(TAB_KEY, next);
    } catch {
      /* the tab just won't be remembered */
    }
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    const result =
      pending.kind === "quit" ? await vitals.act({ action: "quit", app: pending.app.key }) : await vitals.act({ action: "stop", pids: pending.servers.map((x) => x.server.pid) });
    setBusy(false);
    setPending(null);
    const freed = result.ok && result.freed ? ` ${memory(result.freed)} of memory is back.` : "";
    setToast({ message: `${result.message}${freed}`, tone: result.ok ? "good" : "bad" });
  };

  const quit = (app: App) => setPending({ kind: "quit", app });
  const serverCount = snap?.projects.reduce((n, p) => n + p.servers.length, 0) ?? 0;

  let body: ReactNode;
  if (vitals.unsupported) {
    body = (
      <Empty title="Vitals reads the Mac it runs on" text="Open Vitals in the Slates app on your Mac. It reads that Mac's own processes, which the host can't see." />
    );
  } else if (!snap) {
    body = vitals.error ? (
      <Empty title="Couldn’t read this Mac" text={`${vitals.error} Vitals keeps trying.`} />
    ) : (
      <div className={s.loading} aria-busy="true" aria-live="polite">
        <div className={s.tiles}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={`${s.card} ${s.skeleton}`} />
          ))}
        </div>
        <p className={s.footnote}>Reading this Mac…</p>
      </div>
    );
  } else {
    const table = (columns: Metric[], label: string, limit?: number) => (
      <AppTable apps={snap.apps} columns={columns} trail={trail} iconOf={iconOf} onQuit={quit} limit={limit} label={label} />
    );
    const detailed = snap.detailed;
    switch (current) {
      case "cpu":
        body = <CpuView snap={snap} trail={trail} table={table(detailed ? ["cpu", "mem", "power"] : ["cpu", "mem"], "Apps by CPU")} />;
        break;
      case "memory":
        body = <MemoryView snap={snap} trail={trail} table={table(["mem", "cpu"], "Apps by memory")} />;
        break;
      case "disk":
        body = <DiskView snap={snap} trail={trail} table={table(["write", "read"], "Apps by disk")} />;
        break;
      case "network":
        body = <NetworkView snap={snap} trail={trail} table={table(["down", "up"], "Apps by network")} />;
        break;
      case "gpu":
        body = <GpuView snap={snap} trail={trail} table={table(["gpu", "cpu"], "Apps by GPU")} />;
        break;
      case "battery":
        body = <BatteryView snap={snap} trail={trail} table={detailed ? table(["power", "cpu"], "Apps by power") : null} />;
        break;
      case "thermal":
        body = <ThermalView snap={snap} trail={trail} table={table(detailed ? ["cpu", "power", "gpu"] : ["cpu", "gpu"], "Apps making the heat")} />;
        break;
      case "projects":
        body = <ProjectsView projects={snap.projects} ports={snap.ports} onStop={(servers) => setPending({ kind: "stop", servers })} />;
        break;
      default:
        body = <Overview snap={snap} trail={trail} onTab={setTab} table={table(["cpu", "mem"], "Busiest apps", 8)} />;
    }
  }

  return (
    <div className={`shell ui-mode ${s.app}`}>
      <div className="main">
        <header className={`ui-top ${s.top}`}>
          <button type="button" className="ui-back" onClick={clear} aria-label="Back to Slates">
            <Icon path={ICON.chevronLeft} size={13} /> Slates
          </button>
          <span className="ui-top-title">Vitals</span>
          {snap && (
            <nav className={s.tabs} aria-label="Vitals">
              {tabs.map((t) => (
                <button key={t.id} type="button" aria-current={current === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
                  {t.label}
                  {t.id === "projects" && serverCount > 0 && <span className={s.tabCount}>{serverCount}</span>}
                </button>
              ))}
            </nav>
          )}
          <span className={s.spacer} />
          <button
            type="button"
            className={s.live}
            aria-pressed={vitals.live}
            onClick={() => vitals.setLive(!vitals.live)}
            title={vitals.live ? `Reading every ${EVERY_MS / 1000} seconds. Click to pause.` : "Paused. Click to read live again."}
          >
            <span className={s.liveDot} aria-hidden />
            {vitals.live ? "Live" : "Paused"}
          </button>
        </header>

        {snap && vitals.error && !vitals.unsupported && (
          <p className={s.stale} role="status">
            The last reading didn’t come through ({vitals.error}). Showing the one before; Vitals keeps trying.
          </p>
        )}

        <div className={s.scroll}>
          <div className={s.page} key={current}>
            {body}
          </div>
        </div>
      </div>

      {pending?.kind === "quit" && (
        <Confirm title={`Quit ${pending.app.name}?`} action={`Quit ${pending.app.name}`} busy={busy} onConfirm={() => void confirm()} onCancel={() => setPending(null)}>
          <p>
            Its {plural(pending.app.procs.length, "process", "processes")} stop and {memory(pending.app.mem)} of memory comes back. It closes straight away, without asking to
            save, so save anything open in it first.
          </p>
        </Confirm>
      )}
      {pending?.kind === "stop" && <StopConfirm servers={pending.servers} busy={busy} onConfirm={() => void confirm()} onCancel={() => setPending(null)} />}

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />}
    </div>
  );
}

function StopConfirm({ servers, busy, onConfirm, onCancel }: { servers: Stoppable[]; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const ports = servers.flatMap((x) => x.server.ports).sort((a, b) => a - b);
  const mem = servers.reduce((sum, x) => sum + x.server.mem, 0);
  const one = servers.length === 1 ? servers[0]! : null;
  return (
    <Confirm
      title={one ? `Stop ${one.server.name}?` : `Stop ${servers.length} dev servers?`}
      action={one ? "Stop server" : `Stop all ${servers.length}`}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {one ? (
        <p>
          {one.server.runtime} in {one.project.name} stops, as if you’d pressed Control-C in its terminal. {memory(mem)} and {ports.length === 1 ? "port" : "ports"} {andList(ports)} come free.
        </p>
      ) : (
        <>
          <p>
            Each stops as if you’d pressed Control-C in its terminal. {memory(mem)} and {ports.length === 1 ? "port" : "ports"} {andList(ports)} come free.
          </p>
          <ul className={s.dialogList}>
            {servers.map(({ project, server }) => (
              <li key={server.pid}>
                <b>{server.name === project.name ? project.name : `${project.name} › ${server.name}`}</b>
                <span>
                  :{server.ports.join(", :")} · {memory(server.mem)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Confirm>
  );
}

/* ── pieces of a view ──────────────────────────────────────────────────── */

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <section className={`${s.card} ${s.empty}`} role="alert">
      <Icon path={V.laptop} size={22} />
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className={s.stat}>
      <span className={s.statLabel}>{label}</span>
      <span className={s.statValue} data-tone={tone}>
        {value}
      </span>
      {sub && <span className={s.statSub}>{sub}</span>}
    </div>
  );
}

/** What the chart below covers: the session so far, up to five minutes. */
function span(trail: Trail): string {
  const points = trail.points;
  if (points.length < 2) return "Since you opened Vitals";
  const seconds = (points.at(-1)!.at - points[0]!.at) / 1000;
  return points.length >= 120 ? `Last ${duration(seconds)}` : `Since you opened Vitals, ${duration(seconds)} ago`;
}

function Chart({ trail, values, second, max, legend }: { trail: Trail; values: number[]; second?: number[]; max?: number; legend: { label: string; line?: boolean }[] }) {
  return (
    <figure className={s.chartWrap}>
      <Spark values={values} second={second} slots={120} max={max} className={s.chart} />
      <figcaption className={s.chartLegend}>
        {legend.map((item) => (
          <span key={item.label} data-line={item.line || undefined}>
            <i aria-hidden />
            {item.label}
          </span>
        ))}
        <span className={s.chartSpan}>{span(trail)}</span>
      </figcaption>
    </figure>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className={s.section}>
      <header className={s.sectionHead}>
        <h2 className={s.sectionTitle}>{title}</h2>
        {note && <span className={s.sectionNote}>{note}</span>}
      </header>
      <div className={`${s.card} ${s.tableCard}`}>{children}</div>
    </section>
  );
}

const procCount = (snap: VitalsSnapshot) => snap.apps.reduce((n, a) => n + a.procs.length, 0);
const appsNote = (snap: VitalsSnapshot) => `${plural(snap.apps.length, "app")}, ${plural(procCount(snap), "process", "processes")}`;

/* ── overview ──────────────────────────────────────────────────────────── */

interface Notice {
  tone: "bad" | "warn";
  title: string;
  detail: string;
  tab: VitalsTab;
}

/** What's worth a look right now, worst first; three at most. */
function notices(snap: VitalsSnapshot): Notice[] {
  const out: Notice[] = [];
  const { disk, memory: m, battery, thermal } = snap;
  if (thermal?.pressure && thermal.pressure !== "nominal") {
    const fastest = thermal.fans.length ? rpm(Math.max(...thermal.fans.map((f) => f.rpm))) : null;
    const hot = thermal.cpu ? ` The CPU is at ${celsius(thermal.cpu.max)}${fastest ? ` and the fans at ${fastest}` : ""}.` : fastest ? ` The fans are at ${fastest}.` : "";
    out.push({
      tone: thermal.pressure === "moderate" ? "warn" : "bad",
      title: thermal.pressure === "moderate" ? "Your Mac is getting hot" : "Your Mac is slowing itself down to cool off",
      detail: `${PRESSURE_SAYS[thermal.pressure]}.${hot}`,
      tab: "thermal",
    });
  }
  const freeShare = disk.total > 0 ? disk.free / disk.total : 1;
  if (disk.total > 0 && (freeShare < 0.05 || disk.free < 10e9)) {
    out.push({
      tone: freeShare < 0.03 ? "bad" : "warn",
      title: "Your startup disk is almost full",
      detail: `${space(disk.free)} free of ${space(disk.total)}. When it fills up, macOS has nowhere to put swap and starts asking you to quit apps.`,
      tab: "disk",
    });
  }
  if (m.pressure !== "normal") {
    out.push({
      tone: m.pressure === "critical" ? "bad" : "warn",
      title: m.pressure === "critical" ? "Memory is critically short" : "Memory is under pressure",
      detail: `${memory(m.used)} of ${memory(m.total)} in use and ${memory(m.swapUsed)} in swap. Quitting the biggest app is the quickest fix.`,
      tab: "memory",
    });
  } else if (m.swapTotal > 0 && m.swapUsed > 2 * 1024 ** 3 && m.swapUsed / m.swapTotal > 0.75) {
    out.push({
      tone: "warn",
      title: "A lot of memory has spilled into swap",
      detail: `${memory(m.swapUsed)} is in swap on disk, on top of ${memory(m.used)} in memory. Quitting a big app brings it back.`,
      tab: "memory",
    });
  }
  const hog = snap.apps.find((a) => a.kind !== "macos" && a.cpu >= 100);
  if (hog) out.push({ tone: "warn", title: `${hog.name} is using ${pct(hog.cpu)} CPU`, detail: "More than a whole core, right now.", tab: "cpu" });
  const quiet = quietServers(snap.projects);
  const quietMem = quiet.reduce((sum, q) => sum + q.server.mem, 0);
  if (quiet.length && quietMem >= 512 * 1024 ** 2) {
    out.push({
      tone: "warn",
      title: `${quiet.length === 1 ? "A dev server has" : `${quiet.length} dev servers have`} barely run since starting`,
      detail: `${quiet.length === 1 ? "It's" : "They're"} holding ${memory(quietMem)}.`,
      tab: "projects",
    });
  }
  if (battery && battery.health < 80) out.push({ tone: "warn", title: `Battery health is ${battery.health}%`, detail: `After ${plural(battery.cycles, "charge cycle")}.`, tab: "battery" });
  return out.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "bad" ? -1 : 1)).slice(0, 3);
}

function Tile({ icon, label, value, sub, onClick, children }: { icon: string; label: string; value: ReactNode; sub: ReactNode; onClick: () => void; children?: ReactNode }) {
  return (
    <button type="button" className={`${s.card} ${s.tile}`} onClick={onClick}>
      <span className={s.tileHead}>
        <Icon path={icon} size={14} />
        {label}
      </span>
      <span className={s.tileValue}>{value}</span>
      <span className={s.tileSub}>{sub}</span>
      {children && <span className={s.tileFoot}>{children}</span>}
    </button>
  );
}

function memoryParts(m: VitalsSnapshot["memory"]) {
  return [
    { key: "app", label: "App memory", value: m.app },
    { key: "wired", label: "Wired", value: m.wired },
    { key: "compressed", label: "Compressed", value: m.compressed },
    { key: "cached", label: "Cached files", value: m.cached },
    { key: "free", label: "Free", value: m.free },
  ];
}

const PRESSURE = { normal: "Normal", warning: "Under pressure", critical: "Critical" } as const;

function batteryState(b: NonNullable<VitalsSnapshot["battery"]>): string {
  if (b.charging) return b.minutes ? `Charging, full in ${duration(b.minutes * 60)}` : "Charging";
  if (b.plugged) return b.full || b.percent >= 100 ? "Charged" : "Plugged in, not charging";
  return b.minutes ? `${duration(b.minutes * 60)} left` : "On battery";
}

function Overview({ snap, trail, onTab, table }: { snap: VitalsSnapshot; trail: Trail; onTab: (tab: VitalsTab) => void; table: ReactNode }) {
  const { cpu, memory: m, gpu, disk, network: net, battery, host } = snap;
  const points = trail.points;
  const items = notices(snap);
  const servers = snap.projects.flatMap((p) => p.servers);
  const quiet = quietServers(snap.projects);

  return (
    <div className={s.stackCol}>
      <p className={s.hostLine}>
        <b>{host.name}</b>
        <span>{host.chip}</span>
        <span>{memory(host.memory)}</span>
        <span>{host.os}</span>
        <span>up {duration(host.uptime)}</span>
      </p>

      {items.length > 0 && (
        <div className={s.notices}>
          {items.map((n) => (
            <button key={n.title} type="button" className={`${s.card} ${s.notice}`} data-tone={n.tone} onClick={() => onTab(n.tab)}>
              <Icon path={ICON.alert} size={15} />
              <span>
                <b>{n.title}</b>
                <span>{n.detail}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className={s.tiles}>
        <Tile icon={V.chip} label="CPU" value={pct(cpu.total)} sub={`Your apps ${pct(cpu.apps)} · macOS ${pct(cpu.macos)}`} onClick={() => onTab("cpu")}>
          <Spark values={points.map((p) => p.cpu).slice(-TILE_SLOTS)} slots={TILE_SLOTS} max={100} className={s.tileSpark} />
        </Tile>
        <Tile
          icon={V.memory}
          label="Memory"
          value={
            <>
              {memory(m.used)} <small>of {memory(m.total)}</small>
            </>
          }
          sub={`${PRESSURE[m.pressure]} · ${memory(m.swapUsed)} in swap`}
          onClick={() => onTab("memory")}
        >
          <Stack parts={memoryParts(m)} label="How memory is used" />
        </Tile>
        {gpu && (
          <Tile icon={V.gpu} label="GPU" value={pct(gpu.busy)} sub={`${gpu.name}${gpu.cores ? ` · ${gpu.cores} cores` : ""}`} onClick={() => onTab("gpu")}>
            <Spark values={points.map((p) => p.gpu).slice(-TILE_SLOTS)} slots={TILE_SLOTS} max={100} className={s.tileSpark} />
          </Tile>
        )}
        <Tile
          icon={V.disk}
          label="Disk"
          value={
            <>
              {space(disk.free)} <small>free</small>
            </>
          }
          sub={`Reading ${rate(disk.read)} · Writing ${rate(disk.write)}`}
          onClick={() => onTab("disk")}
        >
          <Meter value={disk.total - disk.free} max={disk.total} tone="auto" label="Startup disk used" />
        </Tile>
        <Tile
          icon={V.network}
          label="Network"
          value={
            <span className={s.pair}>
              <span>
                <Icon path={V.down} size={13} />
                {rate(net.down)}
              </span>
              <span>
                <Icon path={V.up} size={13} />
                {rate(net.up)}
              </span>
            </span>
          }
          sub={net.iface ? net.iface.name : "No network"}
          onClick={() => onTab("network")}
        >
          <Spark values={points.map((p) => p.down).slice(-TILE_SLOTS)} second={points.map((p) => p.up).slice(-TILE_SLOTS)} slots={TILE_SLOTS} className={s.tileSpark} />
        </Tile>
        {battery && (
          <Tile icon={V.battery} label="Battery" value={`${battery.percent}%`} sub={`${batteryState(battery)} · health ${battery.health}%`} onClick={() => onTab("battery")}>
            <Meter value={battery.percent} tone={battery.percent <= 15 ? "auto" : "accent"} label="Battery charge" />
          </Tile>
        )}
      </div>

      {snap.thermal && <ThermalStrip thermal={snap.thermal} trail={trail} onClick={() => onTab("thermal")} />}

      <Section title="Busiest apps right now" note={appsNote(snap)}>
        {table}
        <button type="button" className={s.tableMore} onClick={() => onTab("cpu")}>
          Every app <Icon path={V.chevronRight} size={11} />
        </button>
      </Section>

      <button type="button" className={`${s.card} ${s.projectsTile}`} onClick={() => onTab("projects")}>
        <span className={s.projectIcon} aria-hidden>
          <Icon path={V.folder} size={17} />
        </span>
        <span>
          <b>{servers.length ? `${plural(servers.length, "dev server")} in ${plural(snap.projects.length, "project")}` : "No dev servers running"}</b>
          <span>
            {quiet.length
              ? `${quiet.length} barely used since starting, holding ${memory(quiet.reduce((sum, q) => sum + q.server.mem, 0))}`
              : servers.length
                ? `Ports ${andList(servers.flatMap((sv) => sv.ports).sort((a, b) => a - b))}`
                : `${plural(snap.ports.length, "other open port")}`}
          </span>
        </span>
        <Icon path={V.chevronRight} size={12} />
      </button>

      <p className={s.footnote}>
        Read every {EVERY_MS / 1000} seconds while Vitals is open, and kept nowhere.
        {snap.note ? ` ${snap.note}` : ""}
      </p>
    </div>
  );
}

/* ── one view per thing ────────────────────────────────────────────────── */

interface ViewProps {
  snap: VitalsSnapshot;
  trail: Trail;
  table: ReactNode;
}

function CpuView({ snap, trail, table }: ViewProps) {
  const { cpu } = snap;
  const top = snap.apps.find((a) => a.kind !== "macos");
  return (
    <div className={s.stackCol}>
      <section className={`${s.card} ${s.hero}`} aria-label="CPU">
        <div className={s.heroStats}>
          <Stat label="CPU in use" value={pct(cpu.total)} sub={snap.host.chip} />
          <Stat label="Your apps" value={pct(cpu.apps)} sub={top ? `Most: ${top.name}` : undefined} />
          <Stat label="macOS" value={pct(cpu.macos)} sub="The system itself" />
          <Stat label="Load" value={cpu.load.map((n) => n.toFixed(2)).join(" · ")} sub="1, 5 and 15 minutes" />
        </div>
        <Chart trail={trail} values={trail.points.map((p) => p.cpu)} second={trail.points.map((p) => p.apps)} max={100} legend={[{ label: "All" }, { label: "Your apps", line: true }]} />
        <div className={s.cores} aria-label="Each core">
          {cpu.cores.map((core, i) => (
            <span key={i} className={s.core} data-kind={core.kind ?? undefined} title={`${core.kind === "E" ? "Efficiency" : core.kind === "P" ? "Performance" : "Core"} ${i + 1}: ${pct(core.busy)}`}>
              <span className={s.coreBar}>
                <span style={{ transform: `scaleY(${core.busy / 100})` }} />
              </span>
              <span className={s.coreLabel}>{core.kind ?? i + 1}</span>
            </span>
          ))}
          {cpu.cores.some((c) => c.kind) && (
            <span className={s.coreKey}>
              {cpu.cores.filter((c) => c.kind === "P").length} performance and {cpu.cores.filter((c) => c.kind === "E").length} efficiency cores
            </span>
          )}
        </div>
      </section>
      <Section title="Apps by CPU" note={`${appsNote(snap)} · 100% is one whole core`}>
        {table}
      </Section>
    </div>
  );
}

function MemoryView({ snap, trail, table }: ViewProps) {
  const m = snap.memory;
  const parts = memoryParts(m);
  return (
    <div className={s.stackCol}>
      <section className={`${s.card} ${s.hero}`} aria-label="Memory">
        <div className={s.heroStats}>
          <Stat label="Memory used" value={memory(m.used)} sub={`of ${memory(m.total)}`} />
          <Stat label="Pressure" value={PRESSURE[m.pressure]} tone={m.pressure === "normal" ? "good" : m.pressure === "warning" ? "warn" : "bad"} sub="How hard macOS is working to fit it all" />
          <Stat
            label="Swap"
            value={memory(m.swapUsed)}
            sub={m.swapTotal ? `of ${memory(m.swapTotal)} on disk` : "None in use"}
            tone={m.swapTotal && m.swapUsed / m.swapTotal > 0.75 ? "warn" : undefined}
          />
        </div>
        <Stack parts={parts} label="How memory is used" />
        <ul className={s.legend}>
          {parts.map((p) => (
            <li key={p.key} data-part={p.key}>
              <i aria-hidden />
              <span>{p.label}</span>
              <b>{memory(p.value)}</b>
            </li>
          ))}
        </ul>
        <Chart trail={trail} values={trail.points.map((p) => p.mem)} max={m.total} legend={[{ label: "Memory used" }]} />
      </section>
      <Section title="Apps by memory" note={snap.detailed ? `${appsNote(snap)} · as Activity Monitor counts it` : `${appsNote(snap)} · resident size`}>
        {table}
      </Section>
    </div>
  );
}

function DiskView({ snap, trail, table }: ViewProps) {
  const d = snap.disk;
  const used = d.total - d.free;
  const tight = d.total > 0 && d.free / d.total < 0.05;
  return (
    <div className={s.stackCol}>
      <section className={`${s.card} ${s.hero}`} aria-label="Disk">
        <div className={s.heroStats}>
          <Stat label="Free" value={space(d.free)} sub={`of ${space(d.total)}`} tone={tight ? "bad" : undefined} />
          <Stat label="Reading" value={rate(d.read)} />
          <Stat label="Writing" value={rate(d.write)} />
          <Stat label="Since the Mac started" value={`${space(d.readTotal)} read`} sub={`${space(d.writtenTotal)} written`} />
        </div>
        <div className={s.capacity}>
          <Meter value={used} max={d.total} tone="auto" label="Startup disk used" />
          <span>
            {space(used)} used, {pct(d.total ? (used / d.total) * 100 : 0)}
          </span>
        </div>
        <Chart trail={trail} values={trail.points.map((p) => p.read)} second={trail.points.map((p) => p.write)} legend={[{ label: "Reading" }, { label: "Writing", line: true }]} />
      </section>
      <Section title="Apps by disk" note={snap.detailed ? "Your own apps; macOS's processes don't say" : "Disk by app needs Apple's command line tools"}>
        {table}
      </Section>
    </div>
  );
}

function NetworkView({ snap, trail, table }: ViewProps) {
  const n = snap.network;
  return (
    <div className={s.stackCol}>
      <section className={`${s.card} ${s.hero}`} aria-label="Network">
        <div className={s.heroStats}>
          <Stat label="Downloading" value={rate(n.down)} />
          <Stat label="Uploading" value={rate(n.up)} />
          <Stat label="Connected by" value={n.iface ? n.iface.name : "Nothing"} sub={n.iface?.device} />
          <Stat label="Since the Mac started" value={`${space(n.inTotal)} in`} sub={`${space(n.outTotal)} out`} />
        </div>
        <Chart trail={trail} values={trail.points.map((p) => p.down)} second={trail.points.map((p) => p.up)} legend={[{ label: "Download" }, { label: "Upload", line: true }]} />
      </section>
      <Section title="Apps by network" note={appsNote(snap)}>
        {table}
      </Section>
    </div>
  );
}

function GpuView({ snap, trail, table }: ViewProps) {
  const g = snap.gpu!;
  return (
    <div className={s.stackCol}>
      <section className={`${s.card} ${s.hero}`} aria-label="GPU">
        <div className={s.heroStats}>
          <Stat label="GPU in use" value={pct(g.busy)} sub={`${g.name}${g.cores ? `, ${g.cores} cores` : ""}`} />
          <Stat label="Rendering" value={pct(g.renderer)} />
          <Stat label="Tiling" value={pct(g.tiler)} />
          <Stat label="Memory" value={memory(g.mem)} sub="Shared with the CPU" />
        </div>
        <Chart trail={trail} values={trail.points.map((p) => p.gpu)} max={100} legend={[{ label: "GPU in use" }]} />
      </section>
      <Section title="Apps by GPU" note={appsNote(snap)}>
        {table}
      </Section>
    </div>
  );
}

function BatteryView({ snap, trail, table }: { snap: VitalsSnapshot; trail: Trail; table: ReactNode | null }) {
  const b = snap.battery!;
  const appsPower = snap.apps.reduce((sum, a) => sum + (a.power ?? 0), 0);
  return (
    <div className={s.stackCol}>
      <section className={`${s.card} ${s.hero}`} aria-label="Battery">
        <div className={s.heroStats}>
          <Stat label="Battery" value={`${b.percent}%`} sub={batteryState(b)} tone={b.percent <= 15 && !b.plugged ? "bad" : undefined} />
          <Stat label="Health" value={`${b.health}%`} sub={plural(b.cycles, "charge cycle")} tone={b.health < 80 ? "warn" : undefined} />
          <Stat label="Temperature" value={b.temperature === null ? "–" : `${b.temperature.toFixed(0)} °C`} />
          {b.draw !== null ? (
            <Stat label="Drawing" value={watts(b.draw)} sub="From the battery" />
          ) : (
            <Stat label="Adapter" value={b.adapter?.watts ? `${b.adapter.watts} W` : "Plugged in"} sub={b.adapter?.name ?? undefined} />
          )}
        </div>
        <Meter value={b.percent} tone={b.percent <= 15 ? "auto" : "accent"} label="Battery charge" />
        {snap.detailed && (
          <Chart
            trail={trail}
            values={trail.points.map((p) => p.power)}
            legend={[{ label: b.draw !== null ? "Battery draw" : `What your apps draw, ${watts(appsPower)} now` }]}
          />
        )}
      </section>
      {table && (
        <Section title="Apps by power" note="Your own apps, from the energy macOS bills each">
          {table}
        </Section>
      )}
    </div>
  );
}

/* ── heat and fans ─────────────────────────────────────────────────────── */

const PRESSURE_LABEL: Record<ThermalPressure, string> = { nominal: "Normal", moderate: "Moderate", heavy: "Heavy", trapping: "Critical", sleeping: "Critical" };

const PRESSURE_SAYS: Record<ThermalPressure, string> = {
  nominal: "macOS isn't holding the chip back",
  moderate: "macOS is starting to hold the chip back to keep it cool",
  heavy: "macOS is slowing the chip to keep it cool, so everything runs slower",
  trapping: "macOS is slowing the chip hard to keep it cool",
  sleeping: "The Mac is so hot macOS is about to put it to sleep",
};

type Tone = "good" | "warn" | "bad" | undefined;

const pressureTone = (p: ThermalPressure | null): Tone => (!p ? undefined : p === "nominal" ? "good" : p === "moderate" ? "warn" : "bad");

/** Apple silicon runs at 90–100 °C under load as a matter of course, and holds itself back past about 105. */
const tempTone = (c: number | undefined): Tone => (c === undefined ? undefined : c >= 108 ? "bad" : c >= 100 ? "warn" : undefined);

function fanName(i: number, count: number) {
  return count === 1 ? "Fan" : `Fan ${i + 1}`;
}

function fanState(fan: VitalsFan): string {
  if (fan.manual) return "Set by hand, by a fan-control app";
  if (fan.rpm < 100) return "Stopped: the Mac is cool enough without it";
  return fan.target !== null && fan.target > 0 ? `macOS is aiming for ${rpm(fan.target)}` : "Run by macOS";
}

/** A fan that turns as fast as the real one, slowed down to be watchable. */
function FanGlyph({ fan, size = 20 }: { fan: VitalsFan; size?: number }) {
  const spinning = fan.rpm >= 100;
  return (
    <span className={s.fanGlyph} data-spinning={spinning || undefined} style={spinning ? { animationDuration: `${Math.max(0.25, 1500 / fan.rpm).toFixed(2)}s` } : undefined} aria-hidden>
      <Icon path={V.fan} size={size} />
    </span>
  );
}

function fanSummary(fans: VitalsFan[]): string {
  if (!fans.length) return "No fans";
  if (fans.every((f) => f.rpm < 100)) return "Off";
  return rpm(fans.reduce((sum, f) => sum + f.rpm, 0) / fans.length);
}

function ThermalStrip({ thermal: t, trail, onClick }: { thermal: VitalsThermal; trail: Trail; onClick: () => void }) {
  const points = trail.points.slice(-TILE_SLOTS);
  const cells: { label: string; value: string; tone?: "good" | "warn" | "bad" }[] = [
    ...(t.cpu ? [{ label: "CPU", value: celsius(t.cpu.max), tone: tempTone(t.cpu.max) }] : []),
    ...(t.gpu ? [{ label: "GPU", value: celsius(t.gpu.max), tone: tempTone(t.gpu.max) }] : []),
    { label: t.fans.length === 1 ? "Fan" : "Fans", value: fanSummary(t.fans) },
    ...(t.power !== null ? [{ label: "Whole Mac", value: watts(t.power) }] : []),
    ...(t.pressure ? [{ label: "Thermal pressure", value: PRESSURE_LABEL[t.pressure], tone: pressureTone(t.pressure) }] : []),
  ];
  return (
    <button type="button" className={`${s.card} ${s.thermalStrip}`} onClick={onClick}>
      <span className={s.tileHead}>
        <Icon path={V.heat} size={14} />
        Thermals
      </span>
      <span className={s.thermalCells}>
        {cells.map((c) => (
          <span key={c.label}>
            <small>{c.label}</small>
            <b data-tone={c.tone === "good" ? undefined : c.tone}>{c.value}</b>
          </span>
        ))}
      </span>
      {t.cpu && <Spark values={points.map((p) => p.cpuTemp)} second={t.gpu ? points.map((p) => p.gpuTemp) : undefined} slots={TILE_SLOTS} max={110} className={s.thermalSpark} />}
      <Icon path={V.chevronRight} size={12} />
    </button>
  );
}

function ThermalView({ snap, trail, table }: ViewProps) {
  const t = snap.thermal!;
  const points = trail.points;
  const fanTop = Math.max(0, ...t.fans.map((f) => f.max));
  const tempNote = (temp: VitalsTemp) => `Hottest of ${temp.sensors} · average ${celsius(temp.avg)}`;
  return (
    <div className={s.stackCol}>
      <section className={`${s.card} ${s.hero}`} aria-label="Temperatures">
        <div className={s.heroStats}>
          {t.cpu && <Stat label="CPU" value={celsius(t.cpu.max)} sub={tempNote(t.cpu)} tone={tempTone(t.cpu.max)} />}
          {t.gpu && <Stat label="GPU" value={celsius(t.gpu.max)} sub={tempNote(t.gpu)} tone={tempTone(t.gpu.max)} />}
          {t.ssd && <Stat label="SSD" value={celsius(t.ssd.max)} sub="The internal drive" />}
          {t.power !== null && <Stat label="Whole Mac" value={watts(t.power)} sub="Drawing, everything included" />}
        </div>
        {t.pressure && (
          <p className={s.pressure} data-tone={pressureTone(t.pressure)}>
            <i aria-hidden />
            <b>Thermal pressure {PRESSURE_LABEL[t.pressure].toLowerCase()}</b>
            <span>{PRESSURE_SAYS[t.pressure]}.</span>
          </p>
        )}
        {t.cpu && (
          <Chart
            trail={trail}
            values={points.map((p) => p.cpuTemp)}
            second={t.gpu ? points.map((p) => p.gpuTemp) : undefined}
            max={110}
            legend={[{ label: "CPU, hottest sensor" }, ...(t.gpu ? [{ label: "GPU, hottest sensor", line: true }] : [])]}
          />
        )}
      </section>

      <section className={s.section}>
        <header className={s.sectionHead}>
          <h2 className={s.sectionTitle}>{t.fans.length === 1 ? "Fan" : "Fans"}</h2>
          {t.fans.length > 0 && <span className={s.sectionNote}>Apple silicon Macs stop their fans when they’re cool</span>}
        </header>
        <div className={`${s.card} ${s.fans}`}>
          {t.fans.length === 0 ? (
            <p className={s.noFans}>
              <Icon path={V.fan} size={18} />
              This Mac has no fans. It cools without them, and slows the chip a little when it gets hot.
            </p>
          ) : (
            <>
              {t.fans.map((fan, i) => (
                <div key={i} className={s.fan}>
                  <FanGlyph fan={fan} />
                  <span className={s.fanName}>
                    <b>{fanName(i, t.fans.length)}</b>
                    <span>{fanState(fan)}</span>
                  </span>
                  <span className={s.fanRpm}>{fan.rpm < 100 ? "Off" : rpm(fan.rpm)}</span>
                  <span className={s.fanRange}>
                    <Meter value={fan.rpm} max={fan.max || fanTop || 1} label={`${fanName(i, t.fans.length)} speed`} />
                    <span>
                      {pct(fan.max ? Math.min(100, (fan.rpm / fan.max) * 100) : 0)} of its top speed · {Math.round(fan.min).toLocaleString()}–{rpm(fan.max)}
                    </span>
                  </span>
                </div>
              ))}
              <Chart trail={trail} values={points.map((p) => p.fan)} max={fanTop || undefined} legend={[{ label: t.fans.length === 1 ? "Fan speed" : "Fan speed, the fans’ average" }]} />
            </>
          )}
        </div>
      </section>

      <Section title="Apps making the heat" note={`${appsNote(snap)} · the busiest warm the chip most`}>
        {table}
      </Section>
    </div>
  );
}
