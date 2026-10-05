"use client";

import { Fragment, useState } from "react";

import type { VitalsApp, VitalsProc } from "@/lib/vitals/types";
import { Icon, ICON } from "../ui";
import { memory, pct, plural, rate, watts } from "./format";
import { AppIcon, Spark } from "./parts";
import type { Metric, Trail } from "./useVitals";
import s from "./vitals.module.css";

/**
 * Every app with what it's using, its helpers inside it. Rows don't move while
 * the pointer is over the list, so the one you're reaching for is still there
 * when you get to it; the numbers keep moving.
 */

interface Column {
  label: string;
  value: (row: VitalsApp | VitalsProc) => number | null;
  show: (n: number | null) => string;
}

export const COLUMNS: Record<Metric, Column> = {
  cpu: { label: "CPU", value: (r) => r.cpu, show: pct },
  mem: { label: "Memory", value: (r) => r.mem, show: (n) => memory(n ?? 0) },
  power: { label: "Power", value: (r) => r.power, show: watts },
  read: { label: "Reading", value: (r) => r.read, show: rate },
  write: { label: "Writing", value: (r) => r.write, show: rate },
  down: { label: "Download", value: (r) => r.down, show: rate },
  up: { label: "Upload", value: (r) => r.up, show: rate },
  gpu: { label: "GPU", value: (r) => r.gpu, show: pct },
};

const SHOWN_PROCS = 12;

export default function AppTable({
  apps,
  columns,
  trail,
  iconOf,
  onQuit,
  limit,
  label,
}: {
  apps: VitalsApp[];
  columns: Metric[];
  trail: Trail;
  iconOf: (bundle: string | null) => string | null;
  onQuit: (app: VitalsApp) => void;
  /** Only the busiest few, on the overview. */
  limit?: number;
  label: string;
}) {
  const [sort, setSort] = useState<Metric>(columns[0]!);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [all, setAll] = useState<Set<string>>(() => new Set());
  const [held, setHeld] = useState<string[] | null>(null);
  const by = columns.includes(sort) ? sort : columns[0]!;
  const col = COLUMNS[by];

  const ranked = [...apps].sort((a, b) => (col.value(b) ?? -1) - (col.value(a) ?? -1) || b.mem - a.mem);
  const top = limit ? ranked.slice(0, limit) : ranked;
  const byKey = new Map(apps.map((a) => [a.key, a]));
  const rows = held ? [...held.map((k) => byKey.get(k)).filter((a): a is VitalsApp => !!a), ...top.filter((a) => !held.includes(a.key))] : top;
  const peak = Math.max(...rows.map((a) => col.value(a) ?? 0), 1e-9);

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  return (
    <table className={s.table} aria-label={label}>
      <thead>
        <tr>
          <th scope="col" className={s.appHead}>
            App
          </th>
          {columns.map((metric) => (
            <th key={metric} scope="col" className={s.numHead} aria-sort={metric === by ? "descending" : undefined}>
              <button type="button" onClick={() => setSort(metric)} data-on={metric === by || undefined}>
                {COLUMNS[metric].label}
                {metric === by && <Icon path={ICON.chevronDown} size={11} />}
              </button>
            </th>
          ))}
          <th scope="col" className={s.trendHead}>
            Recent
          </th>
          <th scope="col" className={s.actionHead}>
            <span className={s.srOnly}>Quit</span>
          </th>
        </tr>
      </thead>
      <tbody onMouseEnter={() => setHeld(top.map((a) => a.key))} onMouseLeave={() => setHeld(null)}>
        {rows.map((app) => {
          const expanded = open.has(app.key);
          const procs = [...app.procs].sort((a, b) => (col.value(b) ?? -1) - (col.value(a) ?? -1) || b.mem - a.mem);
          const shown = all.has(app.key) ? procs : procs.slice(0, SHOWN_PROCS);
          const value = col.value(app);
          return (
            <Fragment key={app.key}>
              <tr className={s.row} data-open={expanded || undefined}>
                <th scope="row" className={s.appCell}>
                  <button type="button" className={s.appButton} aria-expanded={expanded} onClick={() => setOpen((set) => toggle(set, app.key))}>
                    <span className={s.chevron} aria-hidden>
                      <Icon path={ICON.chevronDown} size={11} />
                    </span>
                    <AppIcon app={app} src={iconOf(app.bundle)} />
                    <span className={s.appText}>
                      <span className={s.appName}>{app.name}</span>
                      <span className={s.appSub}>{plural(app.procs.length, "process", "processes")}</span>
                    </span>
                  </button>
                </th>
                {columns.map((metric, i) => (
                  <td key={metric} className={metric === by ? s.primary : s.num}>
                    {COLUMNS[metric].show(COLUMNS[metric].value(app))}
                    {i === columns.indexOf(by) && (
                      <span className={s.share} aria-hidden>
                        <span style={{ transform: `scaleX(${Math.max(0, Math.min(1, (value ?? 0) / peak))})` }} />
                      </span>
                    )}
                  </td>
                ))}
                <td className={s.trend}>
                  <Spark values={trail.apps.get(app.key)?.[by] ?? []} slots={48} area={false} />
                </td>
                <td className={s.action}>
                  {app.quittable && (
                    <button type="button" className={s.quit} onClick={() => onQuit(app)} aria-label={`Quit ${app.name}`}>
                      Quit
                    </button>
                  )}
                </td>
              </tr>
              {expanded &&
                shown.map((p) => (
                  <tr key={p.pid} className={s.procRow}>
                    <th scope="row" className={s.procCell}>
                      <span className={s.procLine}>
                        <span className={s.procName}>{p.name}</span>
                        <span className={s.pid}>{p.pid}</span>
                      </span>
                    </th>
                    {columns.map((metric) => (
                      <td key={metric} className={s.num}>
                        {COLUMNS[metric].show(COLUMNS[metric].value(p))}
                      </td>
                    ))}
                    <td />
                    <td />
                  </tr>
                ))}
              {expanded && procs.length > SHOWN_PROCS && (
                <tr className={s.procRow}>
                  <td colSpan={columns.length + 3} className={s.moreCell}>
                    <button type="button" className={s.more} onClick={() => setAll((set) => toggle(set, app.key))}>
                      {all.has(app.key) ? "Show fewer" : `Show all ${procs.length}`}
                    </button>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
