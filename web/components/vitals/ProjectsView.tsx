"use client";

import type { VitalsPort, VitalsProject, VitalsServer } from "@/lib/vitals/types";
import { andList, duration, homePath, memory, pct, plural } from "./format";
import { V } from "./parts";
import { Icon } from "../ui";
import s from "./vitals.module.css";

/**
 * Dev servers by the project they run from, with the ones that have sat
 * there doing nothing pointed out, and every other open port below.
 */

/** Servers worth suggesting to stop: barely used since they started, and not Slates. */
export function quietServers(projects: VitalsProject[]): { project: VitalsProject; server: VitalsServer }[] {
  return projects.flatMap((project) => project.servers.filter((server) => server.state === "quiet" && !server.locked).map((server) => ({ project, server })));
}

function stateText(server: VitalsServer): string {
  if (server.state === "working") return `working, ${pct(server.cpu)} CPU`;
  if (server.state === "quiet") return `up ${duration(server.uptime)}, barely used`;
  return `idle, up ${duration(server.uptime)}`;
}

export default function ProjectsView({
  projects,
  ports,
  onStop,
}: {
  projects: VitalsProject[];
  ports: VitalsPort[];
  onStop: (servers: { project: VitalsProject; server: VitalsServer }[]) => void;
}) {
  const quiet = quietServers(projects);
  const quietMem = quiet.reduce((sum, q) => sum + q.server.mem, 0);
  const quietPorts = quiet.flatMap((q) => q.server.ports).sort((a, b) => a - b);

  return (
    <div className={s.stackCol}>
      {quiet.length > 0 && (
        <section className={`${s.card} ${s.callout}`} data-tone="warn" aria-labelledby="vitals-quiet">
          <div className={s.calloutText}>
            <h2 id="vitals-quiet">
              {quiet.length === 1 ? "1 dev server has" : `${quiet.length} dev servers have`} barely run since {quiet.length === 1 ? "it" : "they"} started
            </h2>
            <p>
              Stopping {quiet.length === 1 ? "it" : "them"} frees {memory(quietMem)} and {quietPorts.length === 1 ? "port" : "ports"} {andList(quietPorts)}.
            </p>
          </div>
          <button type="button" className={s.calloutBtn} onClick={() => onStop(quiet)}>
            {quiet.length === 1 ? "Stop it…" : `Stop all ${quiet.length}…`}
          </button>
        </section>
      )}

      {projects.length === 0 ? (
        <section className={`${s.card} ${s.empty}`}>
          <Icon path={V.folder} size={22} />
          <h2>No dev servers running</h2>
          <p>When something on this Mac serves a port from a project folder, like npm run dev or a Python server, it shows up here under its project.</p>
        </section>
      ) : (
        projects.map((project) => {
          const working = project.servers.some((sv) => sv.state === "working");
          return (
            <section key={project.root} className={`${s.card} ${s.project}`} aria-label={project.name}>
              <header className={s.projectHead}>
                <span className={s.projectIcon} aria-hidden>
                  <Icon path={V.folder} size={17} />
                </span>
                <span className={s.projectText}>
                  <h2>{project.name}</h2>
                  <span className={s.projectPath}>{homePath(project.root, null)}</span>
                </span>
                <span className={s.projectMeta}>
                  <span className={s.chip} data-state={working ? "working" : "idle"}>
                    {working ? "working" : "idle"}
                  </span>
                  <span>{plural(project.procs, "process", "processes")}</span>
                  <b>{memory(project.mem)}</b>
                </span>
              </header>
              <ul className={s.servers}>
                {project.servers.map((server) => (
                  <li key={server.pid} className={s.server} data-state={server.state}>
                    <span className={s.ports}>
                      {server.ports.map((port) => (
                        <span key={port} className={s.port}>
                          :{port}
                        </span>
                      ))}
                    </span>
                    <span className={s.serverText}>
                      <span className={s.serverName}>{server.name}</span>
                      <span className={s.serverSub}>
                        {server.runtime} · {stateText(server)}
                      </span>
                    </span>
                    <span className={s.serverMem}>{memory(server.mem)}</span>
                    {server.locked ? (
                      <span className={s.locked}>{server.locked}</span>
                    ) : (
                      <button type="button" className={s.quit} data-always onClick={() => onStop([{ project, server }])} aria-label={`Stop ${server.name} on ${andList(server.ports)}`}>
                        Stop…
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      {ports.length > 0 && (
        <section className={`${s.card} ${s.portsCard}`} aria-labelledby="vitals-ports">
          <h2 id="vitals-ports" className={s.sectionTitle}>
            Other open ports
          </h2>
          <p className={s.sectionNote}>Apps and services listening for connections. They&rsquo;re not dev servers, so Vitals leaves them be.</p>
          <ul className={s.portList}>
            {ports.map((p) => (
              <li key={`${p.pid}:${p.port}`}>
                <span className={s.port}>:{p.port}</span>
                <span className={s.portName}>{p.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
