"use client";

import {
  dismissMultitaskTask,
  stopMultitaskTask,
  useMultitaskEnabled,
  useMultitaskTasks,
  type MultitaskSurface,
  type MultitaskTask,
} from "@/lib/multitask";
import { Icon, ICON, Spinner } from "./ui";

/**
 * Compact Multitask controls — Cursor's Agents Window shows background work
 * as short-titled tasks, not a window-owning spinner. The toggle turns the
 * mode on; the strip lists what is running and what just finished.
 */

export function MultitaskToggle() {
  const { enabled, toggle } = useMultitaskEnabled();

  return (
    <button
      type="button"
      className={`multitask-toggle${enabled ? " is-on" : ""}`}
      onClick={toggle}
      aria-pressed={enabled}
      title={
        enabled
          ? "Multitask on — new asks run in the background so you can keep going"
          : "Multitask off — one reply at a time"
      }
    >
      <Icon path={ICON.bands} size={14} />
      <span>Multitask</span>
    </button>
  );
}

export function MultitaskStrip({
  surface,
  onOpen,
}: {
  surface: MultitaskSurface;
  onOpen: (task: MultitaskTask) => void;
}) {
  const { enabled } = useMultitaskEnabled();
  const tasks = useMultitaskTasks(surface);

  if (!enabled && tasks.length === 0) return null;
  if (tasks.length === 0) {
    return (
      <div className="multitask-strip multitask-strip--hint" role="status">
        Multitask on — send freely; each ask runs in the background.
      </div>
    );
  }

  return (
    <div className="multitask-strip" role="status" aria-live="polite">
      <ul className="multitask-list">
        {tasks.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              className={`multitask-chip is-${task.status}`}
              onClick={() => onOpen(task)}
              title={
                task.status === "running"
                  ? `Open “${task.title}”`
                  : task.error || `Open result — ${task.title}`
              }
            >
              {task.status === "running" ? (
                <Spinner size={12} />
              ) : task.status === "done" ? (
                <Icon path={ICON.check} size={12} />
              ) : (
                <Icon path={ICON.alert} size={12} />
              )}
              <span className="multitask-chip-title truncate">{task.title}</span>
              <span className="multitask-chip-state">
                {task.status === "running"
                  ? "running"
                  : task.status === "done"
                    ? "done"
                    : task.status === "stopped"
                      ? "stopped"
                      : "failed"}
              </span>
            </button>
            {task.status === "running" ? (
              <button
                type="button"
                className="multitask-chip-stop"
                onClick={() => stopMultitaskTask(task.id)}
                aria-label={`Stop ${task.title}`}
                title="Stop"
              >
                <Icon path={ICON.stop} size={10} />
              </button>
            ) : (
              <button
                type="button"
                className="multitask-chip-stop"
                onClick={() => dismissMultitaskTask(task.id)}
                aria-label={`Dismiss ${task.title}`}
                title="Dismiss"
              >
                <Icon path={ICON.close} size={10} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
