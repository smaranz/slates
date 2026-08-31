"use client";

import { useCallback, useEffect, useState } from "react";

import { useStore } from "@/lib/store";
import { fmtMinutes } from "@/lib/format";
import { Badge, ClockIcon, Dot, Icon, ICON, Spinner } from "./ui";

/**
 * A class, the way Schoology files it.
 *
 * The board answers "what do I do next" and throws away everything that isn't
 * due. A class is more than its deadlines: it's the folders the teacher built,
 * the lecture PDFs, the pages and the links. This walks that same tree and
 * opens files in place rather than bouncing you into a browser.
 *
 * Grades deliberately don't appear here — that's what the Grades screen is for.
 */
export default function ClassesView() {
  const s = useStore();
  return s.courseId ? <ClassDetail /> : <ClassList />;
}

function ClassList() {
  const s = useStore();
  const courses = s.snapshot.courses;

  return (
    <div className="scroll">
      <div className="col" style={{ gap: 10 }}>
        {courses.length === 0 && (
          <p style={{ margin: "24px 0", fontSize: 13, color: "var(--muted)", textAlign: "center" }}>
            Nothing synced yet.
          </p>
        )}

        {courses.map((c) => {
          const mine = s.snapshot.assignments.filter((a) => a.courseId === c.id);
          const open = mine.filter((a) => s.statusOf(a) !== "done");
          const minutes = open.reduce((acc, a) => acc + a.minutes, 0);
          const next = open
            .filter((a) => a.dateOffset !== null)
            .sort((x, y) => (x.dateOffset ?? 0) - (y.dateOffset ?? 0))[0];

          return (
            <button
              key={c.id}
              type="button"
              className="card"
              onClick={() => s.openCourse(c.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                width: "100%",
                border: "1px solid var(--line)",
                padding: "16px 20px",
                font: "inherit",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <Dot color={c.dot} size={10} radius={3} />

              <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                <span
                  className="truncate"
                  style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text)" }}
                >
                  {c.name}
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {[c.period, open.length ? `${open.length} open · ${fmtMinutes(minutes)}` : "nothing open"]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {next && (
                  <span
                    className="truncate"
                    style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--faint)" }}
                  >
                    <ClockIcon />
                    Next: {next.title.length > 46 ? `${next.title.slice(0, 45)}…` : next.title}
                  </span>
                )}
              </span>

              <Icon
                path={ICON.chevronDown}
                size={14}
                style={{ color: "var(--faint)", transform: "rotate(-90deg)" }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface Material {
  kind: string;
  title: string;
  filename: string;
  url: string;
  folderId: string | null;
  size: string;
  due: string;
  note: string;
}

interface OpenFile {
  title: string;
  /** Attachment path on Schoology, fetched back through the scraper. */
  file: string;
  /** Set when the app can draw it; null means it belongs in a browser. */
  inlineType: string | null;
  schoologyUrl: string;
}

/** One step of where you are in the tree. */
interface Crumb {
  folderId: string | null;
  title: string;
}

const KIND_LABEL: Record<string, string> = {
  folder: "Folder",
  document: "File",
  assignment: "Assignment",
  assessment: "Quiz",
  page: "Page",
  link: "Link",
};

function ClassDetail() {
  const s = useStore();
  const course = s.courseById(s.courseId!);
  const courseId = course?.id;

  const [trail, setTrail] = useState<Crumb[]>([{ folderId: null, title: "Materials" }]);
  const [items, setItems] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<OpenFile | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const here = trail[trail.length - 1];
  const folderId = here.folderId;

  useEffect(() => {
    if (!courseId) return;
    let live = true;

    const url =
      `/api/materials?course=${encodeURIComponent(courseId)}` +
      (folderId ? `&folder=${encodeURIComponent(folderId)}` : "");

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(url, { cache: "no-store" });
        const body = (await res.json()) as { items?: Material[]; error?: string };
        if (!live) return;
        if (!res.ok) throw new Error(body.error ?? "Couldn't read that folder.");
        setItems(body.items ?? []);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Couldn't read that folder.");
      } finally {
        if (live) setLoading(false);
      }
    })();

    return () => {
      live = false;
    };
  }, [courseId, folderId]);

  /** Work Slates already has opens in Slates, not in a browser tab. */
  const known = useCallback(
    (item: Material) => {
      const id = item.url.match(/\/(?:assignment|assessments)\/(\d+)/)?.[1];
      return id ? s.assignmentById(id) : undefined;
    },
    [s]
  );

  const openItem = async (item: Material) => {
    if (item.kind === "folder" && item.folderId) {
      setTrail((prev) => [...prev, { folderId: item.folderId, title: item.title }]);
      return;
    }

    const mine = known(item);
    if (mine) {
      s.openAssignment(mine.id);
      return;
    }

    if (item.kind === "document") {
      setOpening(item.url);
      try {
        const res = await fetch(`/api/materials?path=${encodeURIComponent(item.url)}`, { cache: "no-store" });
        const body = (await res.json()) as { file?: string; inlineType?: string | null; error?: string };
        if (!res.ok || !body.file) throw new Error(body.error ?? "Couldn't open that file.");
        setFile({
          title: item.title,
          file: body.file,
          inlineType: body.inlineType ?? null,
          schoologyUrl: item.url,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't open that file.");
      } finally {
        setOpening(null);
      }
      return;
    }

    // Pages, links and anything else Schoology owns outright.
    window.open(new URL(item.url, `https://${s.snapshot.domain}`).href, "_blank", "noopener,noreferrer");
  };

  if (!course) return null;
  if (file) {
    return (
      <FileViewer
        file={file}
        domain={s.snapshot.domain}
        trail={trail}
        /* The top bar already owns the only Back button on screen; in here the
           trail is what walks you out, exactly as it does in a folder. */
        onCrumb={(i) => {
          setFile(null);
          setTrail((prev) => prev.slice(0, i + 1));
        }}
      />
    );
  }

  return (
    <div className="scroll">
      <div className="col" style={{ gap: 14 }}>
        {/* The top bar already carries the class name, colour and the way out,
            so this row is the trail through the folders instead. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Trail trail={trail} onCrumb={(i) => setTrail((prev) => prev.slice(0, i + 1))} />
          <span style={{ flex: 1 }} />
          {course.period && <span style={{ fontSize: 12, color: "var(--faint)" }}>{course.period}</span>}
        </div>

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)" }}>
            <Spinner />
            Reading Schoology…
          </div>
        )}

        {error && !loading && <p style={{ margin: 0, fontSize: 13, color: "var(--bad)" }}>{error}</p>}

        {!loading && !error && items.length === 0 && (
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>This folder is empty.</p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((item) => {
            const mine = known(item);
            return (
              <button
                key={item.url}
                type="button"
                className="palette-row"
                onClick={() => void openItem(item)}
                style={{
                  border: "1px solid var(--line)",
                  background: "var(--surface)",
                  padding: "11px 13px",
                  alignItems: "flex-start",
                }}
              >
                <span style={{ display: "flex", width: 18, justifyContent: "center", marginTop: 1, flexShrink: 0 }}>
                  {opening === item.url ? <Spinner size={13} /> : <KindIcon kind={item.kind} tone={course.dot} />}
                </span>

                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="truncate" style={{ display: "block", fontSize: 13.5, color: "var(--text)" }}>
                    {item.title}
                  </span>
                  {(item.due || item.size || item.note) && (
                    <span
                      className="truncate"
                      style={{ display: "block", marginTop: 3, fontSize: 12, color: "var(--muted)" }}
                    >
                      {[item.due, item.size, item.note].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>

                <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
                  {mine && <Badge tone="speed">In Slates</Badge>}
                  <span style={{ fontSize: 11.5, color: "var(--faint)" }}>
                    {KIND_LABEL[item.kind] ?? item.kind}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Where you are in the folder tree, and the way back out.
 *
 * Deliberately the only in-page navigation: the top bar already draws a Back
 * button whenever a class is open, and a second one stacked under it read as
 * two different ways out of the same place.
 */
function Trail({
  trail,
  onCrumb,
  leaf,
}: {
  trail: Crumb[];
  onCrumb: (index: number) => void;
  leaf?: string;
}) {
  const crumbs = trail.map((c) => c.title);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
      {crumbs.map((title, i) => {
        const last = i === crumbs.length - 1 && !leaf;
        return (
          <span key={`${title}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {i > 0 && <span style={{ fontSize: 12, color: "var(--dim)" }}>/</span>}
            <button
              type="button"
              onClick={() => onCrumb(i)}
              disabled={last}
              style={{
                border: 0,
                background: "transparent",
                padding: 0,
                font: "inherit",
                fontSize: 12.5,
                color: last ? "var(--text)" : "var(--muted)",
                cursor: last ? "default" : "pointer",
              }}
            >
              {title}
            </button>
          </span>
        );
      })}
      {leaf && (
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 12, color: "var(--dim)" }}>/</span>
          <span className="truncate" style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            {leaf}
          </span>
        </span>
      )}
    </div>
  );
}

/** Folders take the course's own colour; everything else stays quiet. */
function KindIcon({ kind, tone }: { kind: string; tone: string }) {
  if (kind === "folder") return <Icon path={ICON.folder} size={15} style={{ color: tone }} />;
  if (kind === "document") return <Icon path={ICON.file} size={14} style={{ color: "var(--text-2)" }} />;
  if (kind === "assignment" || kind === "assessment")
    return <Icon path={ICON.assignments} size={13} style={{ color: "var(--muted)" }} />;
  return <Icon path={ICON.external} size={13} style={{ color: "var(--muted)" }} />;
}

/**
 * A file, drawn in the app.
 *
 * The bytes come back through the scraper because they need the Schoology
 * session — this window has no cookies of its own. Chromium draws PDFs and
 * images natively, so anything it can render is handed straight to it, and
 * anything else says so plainly instead of showing an empty frame.
 */
function FileViewer({
  file,
  domain,
  trail,
  onCrumb,
}: {
  file: OpenFile;
  domain: string;
  trail: Crumb[];
  onCrumb: (index: number) => void;
}) {
  const src = `/api/materials/file?path=${encodeURIComponent(file.file)}`;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "0 24px 24px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <Trail trail={trail} onCrumb={onCrumb} leaf={file.title} />
        <span style={{ flex: 1 }} />
        <a
          className="btn"
          href={new URL(file.schoologyUrl, `https://${domain}`).href}
          target="_blank"
          rel="noopener noreferrer"
          style={{ height: 30, textDecoration: "none" }}
        >
          <Icon path={ICON.external} size={13} />
          Open in Schoology
        </a>
      </div>

      {file.inlineType ? (
        <iframe
          src={src}
          title={file.title}
          style={{
            flex: 1,
            minHeight: 0,
            width: "100%",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-sm)",
            background: "var(--surface)",
          }}
        />
      ) : (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            fontSize: 13,
            color: "var(--muted)",
          }}
        >
          Slates can&apos;t draw this kind of file.
          <a className="btn" href={src} download style={{ height: 32, textDecoration: "none" }}>
            Download it
          </a>
        </div>
      )}
    </div>
  );
}
