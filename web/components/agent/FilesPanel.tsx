"use client";

import { useCallback, useEffect, useState } from "react";

import type { ChatEvent, SentFile } from "@/lib/agent/types";
import { canSaveToComputer } from "@/lib/desktop-bridge";
import { receivingFiles, setReceivingFiles } from "../DesktopInbox";
import { fileKind, formatBytes, useHostFile } from "../HostFile";
import f from "../host-files.module.css";
import { Icon, ICON, Spinner, Toggle } from "../ui";
import s from "./agent.module.css";

/**
 * Everything the agents have made on the PC, reachable from wherever the
 * student is: what they sent, newest first, and the rest of their working
 * folder, for files an agent made without sending.
 */

interface WorkspaceFile {
  path: string;
  name: string;
  size: number;
  at: number;
}

function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Row({ url, name, meta, title }: { url: string; name: string; meta: string; title?: string }) {
  const file = useHostFile(url, name);
  return (
    <li>
      <div className={f.row}>
        <Icon path={ICON.file} size={15} style={{ color: "var(--dim)" }} />
        <span className={f.rowText}>
          <span className={f.rowName} title={title ?? name}>{name}</span>
          <span className={f.rowMeta}>{meta}</span>
        </span>
        <button type="button" className={f.iconButton} onClick={file.open} disabled={!!file.busy} aria-label={`Open ${name}`} title="Open">
          {file.busy === "open" ? <Spinner size={12} /> : <Icon path={ICON.external} size={14} />}
        </button>
        <button type="button" className={f.iconButton} onClick={file.save} disabled={!!file.busy} aria-label={`Save ${name}`} title={canSaveToComputer() ? "Show in Finder" : "Download"}>
          {file.busy === "save" ? <Spinner size={12} /> : <Icon path={ICON.download} size={14} />}
        </button>
      </div>
      {file.error && <p className={f.error}>{file.error}</p>}
    </li>
  );
}

export default function FilesPanel({
  onClose,
  onEvent,
}: {
  onClose: () => void;
  onEvent: (listener: (chatId: string, event: ChatEvent) => void) => () => void;
}) {
  const [sent, setSent] = useState<SentFile[] | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receive, setReceive] = useState(receivingFiles);
  const desktop = canSaveToComputer();

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        fetch("/api/agent/outbox", { cache: "no-store" }).then((r) => r.json() as Promise<{ files?: SentFile[] }>),
        fetch("/api/agent/outbox?workspace=1", { cache: "no-store" }).then((r) => r.json() as Promise<{ files?: WorkspaceFile[] }>),
      ]);
      setSent(a.files ?? []);
      setWorkspace(b.files ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const off = onEvent((_chat, event) => {
      if (event.type === "file") void load();
    });
    return () => {
      window.clearTimeout(first);
      off();
    };
  }, [load, onEvent]);

  return (
    <aside className={s.panel} aria-label="Files">
      <div className={s.panelHead}>
        <h2>Files</h2>
        <button type="button" className={s.iconButton} aria-label="Refresh" title="Refresh" onClick={() => void load()}>
          <Icon path={ICON.retry} size={13} />
        </button>
        <button type="button" className={s.iconButton} aria-label="Close files" onClick={onClose}>
          <Icon path={ICON.close} size={14} />
        </button>
      </div>
      <div className={s.panelBody}>
        {desktop && (
          <div className={s.toggleRow}>
            <span>Save files agents send to this Mac</span>
            <Toggle
              on={receive}
              label="Save files agents send to this Mac"
              onClick={() => {
                setReceivingFiles(!receive);
                setReceive(!receive);
              }}
            />
          </div>
        )}
        {desktop && <p className={s.muted}>They go into Downloads › Slates, with a notification. Open a file here to see it in its own app.</p>}

        <h3 className={s.section}>Sent to you</h3>
        {!sent ? (
          <Spinner size={14} />
        ) : sent.length ? (
          <ul className={f.list}>
            {sent.map((file) => (
              <Row
                key={file.id}
                url={`/api/agent/outbox?id=${encodeURIComponent(file.id)}`}
                name={file.name}
                meta={[`from ${file.from}`, ago(file.at), formatBytes(file.size)].join(" · ")}
                title={file.note ? `${file.name}: ${file.note}` : file.name}
              />
            ))}
          </ul>
        ) : (
          <p className={s.muted}>Nothing yet. When an agent makes a document, slides or a spreadsheet for you, it sends it here and to your computer.</p>
        )}

        <h3 className={s.section}>On the PC</h3>
        {!workspace ? (
          <Spinner size={14} />
        ) : workspace.length ? (
          <ul className={f.list}>
            {workspace.map((file) => (
              <Row
                key={file.path}
                url={`/api/agent/outbox?path=${encodeURIComponent(file.path)}`}
                name={file.name}
                meta={[file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "workspace", fileKind(file.name), ago(file.at), formatBytes(file.size)].join(" · ")}
                title={file.path}
              />
            ))}
          </ul>
        ) : (
          <p className={s.muted}>The agents&apos; working folder is empty.</p>
        )}
        {error && <p className={s.bad}>{error}</p>}
      </div>
    </aside>
  );
}
